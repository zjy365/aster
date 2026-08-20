use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

use crate::core_client::CoreClient;

const RECONNECT_DELAY: Duration = Duration::from_millis(250);
/// Mirrors the 65s connection age in the Electron WatchSupervisor
/// (AbortSignal.timeout on the fetch): watch connections are recycled on a
/// fixed deadline so stale half-open streams cannot wedge the UI.
const WATCH_STREAM_TIMEOUT: Duration = Duration::from_secs(65);
/// Delta events accumulate until either cap before one IPC batch: a busy
/// cluster would otherwise pay a round-trip per object and stall the renderer.
const DELTA_BATCH_SIZE: usize = 64;
const DELTA_BATCH_WINDOW: Duration = Duration::from_millis(40);

/// Receives renderer-bound batches; the app adapts a tauri Channel, tests
/// adapt an mpsc sender.
pub type BatchSink = Arc<dyn Fn(Value) -> bool + Send + Sync>;

/// Owns live watch and log-follow subscriptions. Port of WatchSupervisor and
/// LogFollowSupervisor from src/main/core-transport.ts: one subscription per
/// renderer (starting one cancels the previous), ndjson over the core's
/// streaming endpoints, deltas pushed to the renderer through a Channel.
pub struct Streams {
    core: Arc<CoreClient>,
    watches: Mutex<HashMap<String, CancellationToken>>,
    logs: Mutex<HashMap<String, CancellationToken>>,
}

impl Streams {
    pub fn new(core: Arc<CoreClient>) -> Self {
        Self {
            core,
            watches: Mutex::new(HashMap::new()),
            logs: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_watch(self: &Arc<Self>, id: String, request: Value, channel: Channel<Value>) {
        let token = Self::replace_all(&self.watches, &id);
        let this = Arc::clone(self);
        // Delivery failure means the renderer tore down this channel
        // (webview reload); the loop self-terminates instead of streaming
        // into a dead end forever.
        let sink: BatchSink = Arc::new(move |batch| channel.send(batch).is_ok());
        tauri::async_runtime::spawn(async move {
            this.run_watch(&id, request, &sink, token.clone()).await;
            Self::finish(&this.watches, &id, &token);
        });
    }

    pub fn start_logs(self: &Arc<Self>, id: String, request: Value, channel: Channel<Value>, path: &'static str) {
        let token = Self::replace_all(&self.logs, &id);
        let this = Arc::clone(self);
        let sink: BatchSink = Arc::new(move |batch| channel.send(batch).is_ok());
        tauri::async_runtime::spawn(async move {
            this.run_logs(&id, request, &sink, token.clone(), path).await;
            Self::finish(&this.logs, &id, &token);
        });
    }

    pub fn stop_watch(&self, id: &str) {
        Self::cancel(&self.watches, id);
    }

    pub fn stop_logs(&self, id: &str) {
        Self::cancel(&self.logs, id);
    }

    pub fn cancel_all(&self) {
        Self::cancel_map(&self.watches);
        Self::cancel_map(&self.logs);
    }

    /// A renderer keeps at most one subscription of each kind; starting a new
    /// one cancels the active sessions of that kind first.
    fn replace_all(map: &Mutex<HashMap<String, CancellationToken>>, id: &str) -> CancellationToken {
        Self::cancel_map(map);
        let token = CancellationToken::new();
        map.lock().unwrap().insert(id.to_string(), token.clone());
        token
    }

    fn cancel(map: &Mutex<HashMap<String, CancellationToken>>, id: &str) {
        if let Some(token) = map.lock().unwrap().remove(id) {
            token.cancel();
        }
    }

    fn cancel_map(map: &Mutex<HashMap<String, CancellationToken>>) {
        let sessions: Vec<CancellationToken> = map.lock().unwrap().drain().map(|(_, token)| token).collect();
        for token in sessions {
            token.cancel();
        }
    }

    fn finish(map: &Mutex<HashMap<String, CancellationToken>>, id: &str, token: &CancellationToken) {
        let mut sessions = map.lock().unwrap();
        if sessions.get(id) == Some(token) {
            sessions.remove(id);
        }
    }

    async fn run_watch(&self, id: &str, request: Value, sink: &BatchSink, token: CancellationToken) {
        let mut resource_version;
        while !token.is_cancelled() {
            let mut snapshot_body = request.clone();
            if let Some(body) = snapshot_body.as_object_mut() {
                body.remove("continueToken");
                let limit = body.get("limit").and_then(Value::as_i64).unwrap_or(500).min(500);
                body.insert("limit".to_string(), json!(limit));
            }
            let response = match self.core.post("/v1/resources/list", snapshot_body).await {
                Ok(response) => response,
                Err(error) => {
                    let _ = send(sink, json!({ "subscriptionId": id, "kind": "error", "message": error }));
                    return;
                }
            };
            resource_version = response
                .get("resourceVersion")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let mut snapshot = json!({
                "subscriptionId": id,
                "kind": "snapshot",
                "items": response.get("items").cloned().unwrap_or(Value::Array(vec![])),
            });
            if let Some(token_value) = response.get("continueToken") {
                snapshot["continueToken"] = token_value.clone();
            }
            if !resource_version.is_empty() {
                snapshot["resourceVersion"] = json!(resource_version);
            }
            if !send(sink, snapshot) {
                return;
            }

            loop {
                if token.is_cancelled() {
                    return;
                }
                let mut stream_body = request.clone();
                if let Some(body) = stream_body.as_object_mut() {
                    body.remove("limit");
                    body.remove("continueToken");
                    body.insert("resourceVersion".to_string(), json!(resource_version));
                }
                let deadline = tokio::time::Instant::now() + WATCH_STREAM_TIMEOUT;
                let stream = match self.core.post_stream("/v1/resources/watch", stream_body).await {
                    Ok(stream) => stream,
                    Err(error) => {
                        let _ = send(sink, json!({ "subscriptionId": id, "kind": "error", "message": error }));
                        return;
                    }
                };
                let mut lines = Ndjson::new(stream);
                let mut reset = false;
                // Delta events are batched so a busy cluster (or a large watch
                // stream) does not pay one IPC round-trip per object. The batch
                // flushes on size or on a short tick; the renderer already
                // merges multi-event deltas in one pass.
                let mut pending_deltas: Vec<Value> = Vec::with_capacity(DELTA_BATCH_SIZE);
                // resourceVersion advances with every event; the batch carries
                // the latest one seen so far (versions are monotonic).
                let mut pending_version = String::new();
                let mut batch_deadline = tokio::time::Instant::now() + DELTA_BATCH_WINDOW;
                loop {
                    let mut flush = !pending_deltas.is_empty()
                        && (pending_deltas.len() >= DELTA_BATCH_SIZE
                            || tokio::time::Instant::now() >= batch_deadline);
                    if !flush {
                        let item = tokio::select! {
                            () = tokio::time::sleep_until(batch_deadline) => {
                                flush = !pending_deltas.is_empty();
                                batch_deadline = tokio::time::Instant::now() + DELTA_BATCH_WINDOW;
                                continue;
                            }
                            () = tokio::time::sleep_until(deadline) => break,
                            item = lines.next(&token) => item,
                        };
                        match item {
                            NdjsonItem::Cancelled => return,
                            NdjsonItem::Ended => break,
                            NdjsonItem::Failed(error) => {
                                let _ = send(sink, json!({ "subscriptionId": id, "kind": "error", "message": error }));
                                return;
                            }
                            NdjsonItem::Line(line) => {
                                let event: Value = match serde_json::from_str(&line) {
                                    Ok(event) => event,
                                    Err(_) => continue,
                                };
                                if let Some(version) = event.get("resourceVersion").and_then(Value::as_str) {
                                    resource_version = version.to_string();
                                    pending_version = resource_version.clone();
                                }
                                match event.get("type").and_then(Value::as_str).unwrap_or("") {
                                    "BOOKMARK" => continue,
                                    "RESET" => {
                                        reset = true;
                                        break;
                                    }
                                    "ERROR" => {
                                        let message = event
                                            .pointer("/error/message")
                                            .and_then(Value::as_str)
                                            .unwrap_or("Kubernetes watch failed");
                                        let _ = send(sink, json!({ "subscriptionId": id, "kind": "error", "message": message }));
                                        return;
                                    }
                                    _ => {
                                        if let Some(mut delta) = delta_batch_from_watch_event(id, &event, &resource_version) {
                                            if let Some(events) = delta.get_mut("events").and_then(|value| value.as_array_mut()) {
                                                pending_deltas.append(events);
                                                batch_deadline = tokio::time::Instant::now() + DELTA_BATCH_WINDOW;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if flush {
                        let mut batch = json!({
                            "subscriptionId": id,
                            "kind": "delta",
                            "events": pending_deltas,
                        });
                        if !pending_version.is_empty() {
                            batch["resourceVersion"] = json!(pending_version);
                        }
                        if !send(sink, batch) {
                            return;
                        }
                        pending_deltas = Vec::with_capacity(DELTA_BATCH_SIZE);
                        pending_version.clear();
                        batch_deadline = tokio::time::Instant::now() + DELTA_BATCH_WINDOW;
                    }
                }
                // Flush whatever accumulated, even on RESET: events already
                // seen were real and the original per-event delivery guaranteed
                // they reached the renderer before the relist snapshot.
                if !pending_deltas.is_empty() {
                    let mut batch = json!({
                        "subscriptionId": id,
                        "kind": "delta",
                        "events": pending_deltas,
                    });
                    if !pending_version.is_empty() {
                        batch["resourceVersion"] = json!(pending_version);
                    }
                    if !send(sink, batch) {
                        return;
                    }
                }
                if reset {
                    break;
                }
                // Stream ended or was recycled: brief delay, then reopen.
                if !cancellable_delay(RECONNECT_DELAY, &token).await {
                    return;
                }
            }
        }
    }

    async fn run_logs(&self, id: &str, request: Value, sink: &BatchSink, token: CancellationToken, path: &str) {
        while !token.is_cancelled() {
            let stream = match self.core.post_stream(path, request.clone()).await {
                Ok(stream) => stream,
                Err(error) => {
                    let _ = send(sink, json!({ "subscriptionId": id, "type": "error", "message": error }));
                    return;
                }
            };
            let mut lines = Ndjson::new(stream);
            loop {
                match lines.next(&token).await {
                    NdjsonItem::Cancelled => return,
                    NdjsonItem::Ended => break,
                    NdjsonItem::Failed(error) => {
                        let _ = send(sink, json!({ "subscriptionId": id, "type": "error", "message": error }));
                        return;
                    }
                    NdjsonItem::Line(line) => {
                        let Ok(event) = serde_json::from_str::<Value>(&line) else { continue };
                        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("line");
                        let mut batch = json!({
                            "subscriptionId": id,
                            "type": event_type,
                        });
                        if let Some(text) = event.get("text") {
                            batch["text"] = text.clone();
                        }
                        if let Some(message) = event.get("message") {
                            batch["message"] = message.clone();
                        }
                        if let Some(pod) = event.get("pod") {
                            batch["pod"] = pod.clone();
                        }
                        if !send(sink, batch) {
                            return;
                        }
                    }
                }
            }
            if !token.is_cancelled() && !cancellable_delay(RECONNECT_DELAY, &token).await {
                return;
            }
        }
    }
}

fn send(sink: &BatchSink, batch: Value) -> bool {
    sink(batch)
}

/// Returns false when the delay was cut short by cancellation.
async fn cancellable_delay(duration: Duration, token: &CancellationToken) -> bool {
    tokio::select! {
        () = token.cancelled() => false,
        () = tokio::time::sleep(duration) => true,
    }
}

/// Maps one ndjson watch event to a renderer delta batch. Port of
/// deltaBatchFromWatchEvent; rows stay raw because the renderer normalizes
/// them with shared/normalize.ts.
pub fn delta_batch_from_watch_event(id: &str, event: &Value, resource_version: &str) -> Option<Value> {
    let resource = event.get("resource")?;
    let event_type = event.get("type")?.as_str()?.to_lowercase();
    let delta = match event_type.as_str() {
        "deleted" => json!({ "type": "deleted", "key": resource_key(resource) }),
        "added" | "modified" => json!({ "type": event_type, "row": resource }),
        _ => return None,
    };
    let mut batch = json!({ "subscriptionId": id, "kind": "delta", "events": [delta] });
    if !resource_version.is_empty() {
        batch["resourceVersion"] = json!(resource_version);
    }
    Some(batch)
}

fn resource_key(row: &Value) -> String {
    let uid = row.get("uid").and_then(Value::as_str).unwrap_or("");
    if !uid.is_empty() {
        return uid.to_string();
    }
    let kind = row.get("kind").and_then(Value::as_str).unwrap_or("");
    let namespace = row.get("namespace").and_then(Value::as_str).unwrap_or("");
    let name = row.get("name").and_then(Value::as_str).unwrap_or("");
    format!("{kind}:{namespace}/{name}")
}

pub enum NdjsonItem {
    Line(String),
    Ended,
    Cancelled,
    Failed(String),
}

/// Incremental ndjson decoder over a byte stream; cancellation is checked
/// while waiting for the next chunk.
pub struct Ndjson<S> {
    stream: S,
    buffer: String,
    ended: bool,
}

impl<S, E> Ndjson<S>
where
    S: Stream<Item = Result<Bytes, E>> + Unpin,
    E: std::fmt::Display,
{
    pub fn new(stream: S) -> Self {
        Self { stream, buffer: String::new(), ended: false }
    }

    pub async fn next(&mut self, token: &CancellationToken) -> NdjsonItem {
        loop {
            if let Some(newline) = self.buffer.find('\n') {
                let line = self.buffer.drain(..=newline).collect::<String>();
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                return NdjsonItem::Line(line.to_string());
            }
            if self.ended {
                let tail = self.buffer.trim().to_string();
                self.buffer.clear();
                if tail.is_empty() {
                    return NdjsonItem::Ended;
                }
                return NdjsonItem::Line(tail);
            }
            tokio::select! {
                () = token.cancelled() => return NdjsonItem::Cancelled,
                chunk = self.stream.next() => match chunk {
                    None => self.ended = true,
                    Some(Err(error)) => return NdjsonItem::Failed(error.to_string()),
                    Some(Ok(bytes)) => self.buffer.push_str(&String::from_utf8_lossy(&bytes)),
                },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core_client::CredentialProvider;
    use futures_util::stream;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    fn byte_stream(chunks: Vec<&'static str>) -> impl Stream<Item = Result<Bytes, std::io::Error>> {
        stream::iter(chunks.into_iter().map(|chunk| Ok(Bytes::from(chunk))))
    }

    #[tokio::test]
    async fn decodes_lines_split_across_chunks() {
        let token = CancellationToken::new();
        let mut lines = Ndjson::new(byte_stream(vec!["{\"a\":1", "}\n{\"b\":2}\n", "{\"c\":3}"]));
        match lines.next(&token).await {
            NdjsonItem::Line(line) => assert_eq!(line, "{\"a\":1}"),
            _ => panic!("expected first line"),
        }
        match lines.next(&token).await {
            NdjsonItem::Line(line) => assert_eq!(line, "{\"b\":2}"),
            _ => panic!("expected second line"),
        }
        // Trailing document without a newline is delivered, then the stream ends.
        match lines.next(&token).await {
            NdjsonItem::Line(line) => assert_eq!(line, "{\"c\":3}"),
            _ => panic!("expected trailing line"),
        }
        assert!(matches!(lines.next(&token).await, NdjsonItem::Ended));
    }

    #[tokio::test]
    async fn cancellation_wins_over_a_pending_stream() {
        let token = CancellationToken::new();
        let pending = stream::pending::<Result<Bytes, std::io::Error>>();
        let mut lines = Ndjson::new(pending);
        token.cancel();
        assert!(matches!(lines.next(&token).await, NdjsonItem::Cancelled));
    }

    #[test]
    fn maps_watch_events_to_delta_batches() {
        let added = json!({ "type": "ADDED", "resource": { "uid": "u1", "kind": "Pod", "name": "p" } });
        let batch = delta_batch_from_watch_event("sub", &added, "42").unwrap();
        assert_eq!(batch["kind"], "delta");
        assert_eq!(batch["resourceVersion"], "42");
        assert_eq!(batch["events"][0]["type"], "added");
        assert_eq!(batch["events"][0]["row"]["uid"], "u1");

        let deleted = json!({ "type": "DELETED", "resource": { "uid": "", "kind": "Pod", "namespace": "ns", "name": "p" } });
        let batch = delta_batch_from_watch_event("sub", &deleted, "").unwrap();
        assert_eq!(batch["events"][0], json!({ "type": "deleted", "key": "Pod:ns/p" }));
        assert!(batch.get("resourceVersion").is_none());

        let bookmark = json!({ "type": "BOOKMARK" });
        assert!(delta_batch_from_watch_event("sub", &bookmark, "").is_none());
    }

    struct StaticCredentials {
        base_url: String,
    }

    impl CredentialProvider for StaticCredentials {
        fn credentials(&self) -> Result<(String, String), String> {
            Ok((self.base_url.clone(), "test-token".to_string()))
        }
    }

    #[derive(Debug)]
    struct Recorded {
        path: String,
        authorization: String,
        body: String,
    }

    /// Minimal HTTP/1.1 core fixture: JSON for /v1/resources/list, ndjson for
    /// /v1/resources/watch and /v1/pods/logs/stream, everything recorded.
    struct Fixture {
        port: u16,
        recorded: Arc<Mutex<Vec<Recorded>>>,
        watch_calls: Arc<Mutex<u32>>,
    }

    impl Fixture {
        async fn start() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let fixture = Self {
                port: listener.local_addr().unwrap().port(),
                recorded: Arc::new(Mutex::new(Vec::new())),
                watch_calls: Arc::new(Mutex::new(0)),
            };
            let recorded = fixture.recorded.clone();
            let watch_calls = fixture.watch_calls.clone();
            tokio::spawn(async move {
                loop {
                    let Ok((socket, _)) = listener.accept().await else { return };
                    let recorded = recorded.clone();
                    let watch_calls = watch_calls.clone();
                    tokio::spawn(async move {
                        let _ = serve(socket, recorded, watch_calls).await;
                    });
                }
            });
            fixture
        }

        fn client(&self) -> Arc<CoreClient> {
            Arc::new(CoreClient::new(Arc::new(StaticCredentials {
                base_url: format!("http://127.0.0.1:{}", self.port),
            })))
        }
    }

    async fn serve(
        mut socket: TcpStream,
        recorded: Arc<Mutex<Vec<Recorded>>>,
        watch_calls: Arc<Mutex<u32>>,
    ) -> std::io::Result<()> {
        let (head, body) = read_request(&mut socket).await?;
        let path = head.lines().next().unwrap_or("").split(' ').nth(1).unwrap_or("").to_string();
        let authorization = head
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.trim().eq_ignore_ascii_case("authorization") {
                    Some(value.trim().to_string())
                } else {
                    None
                }
            })
            .unwrap_or_default();
        recorded.lock().unwrap().push(Recorded { path: path.clone(), authorization, body });

        match path.as_str() {
            "/v1/resources/list" => {
                respond_json(&mut socket, r#"{"items":[{"uid":"u0","apiVersion":"v1","kind":"Pod","name":"existing"}],"resourceVersion":"100"}"#).await
            }
            "/v1/resources/watch" => {
                *watch_calls.lock().unwrap() += 1;
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\n\r\n")
                    .await?;
                socket
                    .write_all(b"{\"type\":\"ADDED\",\"resource\":{\"uid\":\"u1\",\"apiVersion\":\"v1\",\"kind\":\"Pod\",\"name\":\"p\"},\"resourceVersion\":\"101\"}\n")
                    .await?;
                socket.write_all(b"{\"type\":\"RESET\",\"resourceVersion\":\"101\"}\n").await?;
                // Close-delimited end of stream; the supervisor must re-list.
                Ok(())
            }
            "/v1/pods/logs/stream" => {
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\n\r\n")
                    .await?;
                socket.write_all(b"{\"type\":\"line\",\"text\":\"first\"}\n").await?;
                socket.write_all(b"{\"type\":\"line\",\"text\":\"second\"}\n").await?;
                Ok(())
            }
            _ => {
                respond_json(&mut socket, r#"{"error":{"message":"unknown path"}}"#).await
            }
        }
    }

    async fn read_request(socket: &mut TcpStream) -> std::io::Result<(String, String)> {
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 4_096];
        let head_end = loop {
            let read = socket.read(&mut chunk).await?;
            if read == 0 {
                return Err(std::io::ErrorKind::UnexpectedEof.into());
            }
            buffer.extend_from_slice(&chunk[..read]);
            if let Some(pos) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                break pos + 4;
            }
        };
        let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
        let content_length = head
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.trim().eq_ignore_ascii_case("content-length") {
                    value.trim().parse::<usize>().ok()
                } else {
                    None
                }
            })
            .unwrap_or(0);
        let mut body = buffer[head_end..].to_vec();
        while body.len() < content_length {
            let read = socket.read(&mut chunk).await?;
            if read == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..read]);
        }
        body.truncate(content_length);
        Ok((head, String::from_utf8_lossy(&body).to_string()))
    }

    async fn respond_json(socket: &mut TcpStream, body: &str) -> std::io::Result<()> {
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        socket.write_all(response.as_bytes()).await
    }

    #[tokio::test]
    async fn watch_runs_snapshot_delta_reset_snapshot_then_cancels() {
        let fixture = Fixture::start().await;
        let streams = Arc::new(Streams::new(fixture.client()));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
        let sink: BatchSink = Arc::new(move |batch| tx.send(batch).is_ok());
        let token = CancellationToken::new();

        let task = {
            let streams = streams.clone();
            let sink = sink.clone();
            let token = token.clone();
            tokio::spawn(async move {
                streams
                    .run_watch("sub-1", json!({"contextId":"ctx","gvr":{"group":"","version":"v1","resource":"pods"},"limit":700}), &sink, token)
                    .await;
            })
        };

        let first = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap();
        assert_eq!(first["kind"], "snapshot");
        assert_eq!(first["items"][0]["name"], "existing");
        assert_eq!(first["resourceVersion"], "100");

        let second = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap();
        assert_eq!(second["kind"], "delta");
        assert_eq!(second["events"][0]["type"], "added");
        assert_eq!(second["events"][0]["row"]["uid"], "u1");
        assert_eq!(second["resourceVersion"], "101");

        // RESET must flush any buffered deltas, then trigger a re-list and a
        // fresh snapshot.
        let third = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap();
        assert_eq!(third["kind"], "snapshot");

        token.cancel();
        tokio::time::timeout(Duration::from_secs(5), task).await.unwrap().unwrap();

        let recorded = fixture.recorded.lock().unwrap();
        assert!(recorded.iter().all(|entry| entry.authorization == "Bearer test-token"));
        let list = recorded.iter().find(|entry| entry.path == "/v1/resources/list").unwrap();
        // The supervisor caps page size at 500 even when the renderer asks for more.
        assert!(list.body.contains(r#""limit":500"#), "list body: {}", list.body);
        let watch = recorded.iter().find(|entry| entry.path == "/v1/resources/watch").unwrap();
        assert!(watch.body.contains(r#""resourceVersion":"100"#), "watch body: {}", watch.body);
    }

    #[tokio::test]
    async fn logs_stream_reconnects_after_eof() {
        let fixture = Fixture::start().await;
        let streams = Arc::new(Streams::new(fixture.client()));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
        let sink: BatchSink = Arc::new(move |batch| tx.send(batch).is_ok());
        let token = CancellationToken::new();

        let task = {
            let streams = streams.clone();
            let sink = sink.clone();
            let token = token.clone();
            tokio::spawn(async move {
                streams
                    .run_logs("log-1", json!({"contextId":"ctx","namespace":"default","name":"pod"}), &sink, token, "/v1/pods/logs/stream")
                    .await;
            })
        };

        let first = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap();
        assert_eq!(first, json!({"subscriptionId":"log-1","type":"line","text":"first"}));
        let second = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap();
        assert_eq!(second["text"], "second");

        token.cancel();
        tokio::time::timeout(Duration::from_secs(5), task).await.unwrap().unwrap();
    }
}
