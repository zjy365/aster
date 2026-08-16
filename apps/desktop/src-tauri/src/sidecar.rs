use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio_util::sync::CancellationToken;

use crate::settings::SettingsFile;

const READY_TIMEOUT: Duration = Duration::from_secs(10);
const STDERR_TAIL: usize = 8_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CoreState {
    Starting,
    Ready,
    Error,
    #[default]
    Stopped,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreStatus {
    pub state: CoreState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReadyMessage {
    #[serde(rename = "type")]
    pub kind: String,
    #[allow(dead_code)]
    pub address: Option<String>,
    pub port: u16,
}

/// Parses the first stdout line of the sidecar. Pure so the contract is testable.
pub fn parse_ready_message(line: &str) -> Result<ReadyMessage, String> {
    let ready: ReadyMessage =
        serde_json::from_str(line).map_err(|error| format!("invalid ready payload: {error}"))?;
    if ready.kind != "ready" || ready.port == 0 {
        return Err("invalid ready payload".to_string());
    }
    Ok(ready)
}

#[derive(Default)]
struct Inner {
    token: String,
    base_url: String,
    stop: Option<CancellationToken>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// Ownership generation. Bumped on every hand-off (stop, restart, crash
    /// cleanup); exit watchers and in-flight starts from older generations
    /// are stale and must not touch shared state.
    generation: u64,
}

/// Owns the Go sidecar process, its bearer token, and its loopback base URL.
/// The token never leaves this module; consumers ask for credentials() per
/// request so a restarting sidecar cannot leak stale authorization.
pub struct Sidecar<R: Runtime> {
    app: AppHandle<R>,
    settings: Arc<SettingsFile>,
    inner: Mutex<Inner>,
    status: RwLock<CoreStatus>,
}

impl<R: Runtime> Sidecar<R> {
    pub fn new(app: AppHandle<R>, settings: Arc<SettingsFile>) -> Self {
        Self {
            app,
            settings,
            inner: Mutex::new(Inner::default()),
            status: RwLock::new(CoreStatus::default()),
        }
    }

    pub fn status(&self) -> CoreStatus {
        self.status.read().unwrap().clone()
    }

    pub fn credentials(&self) -> Result<(String, String), String> {
        let status = self.status.read().unwrap();
        if status.state != CoreState::Ready {
            return Err(status.message.clone().unwrap_or_else(|| "Aster core is not ready".to_string()));
        }
        let inner = self.inner.lock().unwrap();
        if inner.base_url.is_empty() {
            return Err("Aster core is not ready".to_string());
        }
        Ok((inner.base_url.clone(), inner.token.clone()))
    }

    pub async fn start(self: &Arc<Self>) -> Result<(), String> {
        // Reserve the slot and capture the generation synchronously: a
        // concurrent start sees the reservation and bails, and stop() or
        // restart() during the ready window invalidates us via a bump.
        let stop = CancellationToken::new();
        let generation = {
            let mut inner = self.inner.lock().unwrap();
            if inner.stop.is_some() {
                return Ok(());
            }
            inner.stop = Some(stop.clone());
            inner.generation
        };

        if let Err(error) = self.launch(generation, &stop).await {
            self.retire(generation);
            self.set_status(CoreStatus {
                state: CoreState::Error,
                message: Some(error.clone()),
                ..CoreStatus::default()
            });
            return Err(error);
        }
        Ok(())
    }

    async fn launch(self: &Arc<Self>, generation: u64, stop: &CancellationToken) -> Result<(), String> {
        let executable = resolve_executable();
        if !executable.exists() {
            // Keep install paths out of renderer-facing errors.
            eprintln!("Aster core is missing at {}", executable.display());
            return Err("Aster core is missing".to_string());
        }
        let token = random_token();
        self.set_status(CoreStatus { state: CoreState::Starting, ..CoreStatus::default() });

        let mut command = Command::new(&executable);
        command
            .env("ASTER_BOOTSTRAP_TOKEN", &token)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        // Configured sources ride the environment; the core appends them ahead
        // of the standard ~/.kube/config chain.
        let sources = self.settings.read().kubeconfig_sources;
        if !sources.is_empty() {
            command.env("ASTER_KUBECONFIG_SOURCES", sources.join(if cfg!(windows) { ";" } else { ":" }));
        }

        let mut child = command.spawn().map_err(|error| format!("Failed to spawn Aster core: {error}"))?;
        let stdout = child.stdout.take().ok_or("Aster core stdout is unavailable")?;
        let stderr_buffer: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(drain_stderr(stderr, stderr_buffer.clone()));
        }

        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let ready = tokio::select! {
            () = stop.cancelled() => Err("Aster core startup was cancelled".to_string()),
            read = reader.read_line(&mut line) => match read {
                Ok(_) => parse_ready_message(line.trim()),
                Err(error) => Err(format!("Aster core exited before ready: {error}")),
            },
            _ = tokio::time::sleep(READY_TIMEOUT) => Err("Aster core did not become ready within 10 seconds".to_string()),
        };
        let port = match ready {
            Ok(ready) => ready.port,
            Err(message) => {
                let _ = child.kill().await;
                return Err(message);
            }
        };

        // Register credentials only if this generation still owns the shell:
        // a stop() during the ready window bumped past us and already killed
        // the reservation; the child must not be wired into shared state.
        let superseded = {
            let mut inner = self.inner.lock().unwrap();
            if inner.generation != generation {
                true
            } else {
                inner.token = token;
                inner.base_url = format!("http://127.0.0.1:{port}");
                false
            }
        };
        if superseded {
            let _ = child.kill().await;
            return Err("Aster core startup was cancelled".to_string());
        }
        let this = Arc::clone(self);
        let stop_for_watcher = stop.clone();
        let task = tauri::async_runtime::spawn(async move {
            this.watch_exit(child, generation, stop_for_watcher, stderr_buffer).await;
        });
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.generation == generation {
                inner.task = Some(task);
                // Transition under the lock: a crash cleanup retires the
                // generation before touching status, so it can never be
                // overwritten by this Ready.
                let version = self.app.package_info().version.to_string();
                self.set_status(CoreStatus { state: CoreState::Ready, version: Some(version), ..CoreStatus::default() });
            }
        }
        Ok(())
    }

    pub async fn stop(self: &Arc<Self>) {
        // Invalidate every live generation, then cancel and drain the task.
        let (stop, task) = {
            let mut inner = self.inner.lock().unwrap();
            inner.generation += 1;
            (inner.stop.take(), inner.task.take())
        };
        if let Some(stop) = stop {
            stop.cancel();
        }
        if let Some(task) = task {
            let _ = task.await;
        }
        self.set_status(CoreStatus { state: CoreState::Stopped, ..CoreStatus::default() });
    }

    /// Sources are captured at core startup, so applying means a restart.
    pub async fn restart(self: &Arc<Self>) -> Result<(), String> {
        self.stop().await;
        self.start().await
    }

    async fn watch_exit(self: &Arc<Self>, mut child: Child, generation: u64, stop: CancellationToken, stderr: Arc<Mutex<String>>) {
        let status = tokio::select! {
            () = stop.cancelled() => {
                let _ = child.kill().await;
                child.wait().await
            }
            status = child.wait() => status,
        };
        // Reap the child regardless; only the current generation may retire
        // shared state. Expected stops bump the generation in stop() first
        // and own the Stopped transition themselves.
        if !self.retire(generation) {
            return;
        }
        let detail = status
            .map(|exit| exit.code().map(|code| code.to_string()).unwrap_or_else(|| "signal".to_string()))
            .unwrap_or_else(|error| error.to_string());
        let tail = stderr.lock().unwrap().clone();
        let message = format!("Core stopped unexpectedly ({detail}). {tail}").trim().to_string();
        self.set_status(CoreStatus { state: CoreState::Error, message: Some(message), ..CoreStatus::default() });
    }

    /// Clears shared state iff `generation` is still current. Returns false
    /// for stale callers without touching anything.
    fn retire(&self, generation: u64) -> bool {
        let mut inner = self.inner.lock().unwrap();
        if inner.generation != generation {
            return false;
        }
        inner.generation += 1;
        inner.token.clear();
        inner.base_url.clear();
        inner.stop = None;
        inner.task = None;
        true
    }

    fn set_status(&self, status: CoreStatus) {
        *self.status.write().unwrap() = status.clone();
        let _ = self.app.emit("core:status-changed", status);
    }

    #[cfg(test)]
    fn debug_state(&self) -> (u64, bool, bool) {
        let inner = self.inner.lock().unwrap();
        (inner.generation, inner.stop.is_some(), inner.task.is_some())
    }
}

async fn drain_stderr(mut stderr: tokio::process::ChildStderr, buffer: Arc<Mutex<String>>) {
    let mut chunk = [0u8; 4_096];
    loop {
        match stderr.read(&mut chunk).await {
            Ok(0) | Err(_) => return,
            Ok(read) => {
                let mut buffer = buffer.lock().unwrap();
                buffer.push_str(&String::from_utf8_lossy(&chunk[..read]));
                if buffer.len() > STDERR_TAIL {
                    let overflow = buffer.len() - STDERR_TAIL;
                    buffer.drain(..overflow);
                }
            }
        }
    }
}

fn random_token() -> String {
    let bytes: [u8; 32] = rand::random();
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Resolution order: explicit override (tests, power users), the bundled
/// sidecar next to the executable (Tauri strips the target-triple suffix
/// when packaging externalBin), then the dev-time copy produced by
/// scripts/build-core.mjs.
pub fn resolve_executable() -> PathBuf {
    if let Some(override_path) = std::env::var_os("ASTER_CORE_PATH") {
        return PathBuf::from(override_path);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(directory) = exe.parent() {
            for name in ["aster-core", &executable_name()] {
                let bundled = directory.join(name);
                if bundled.exists() {
                    return bundled;
                }
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(&executable_name())
}

fn executable_name() -> String {
    let base = format!("aster-core-{}", target_triple());
    if cfg!(windows) { format!("{base}.exe") } else { base }
}

fn target_triple() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "aarch64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::SettingsFile;
    use std::io::Write;

    fn write_core_script(body: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("aster-fake-core-{}.sh", std::process::id()));
        let mut file = std::fs::File::create(&path).unwrap();
        writeln!(file, "#!/bin/sh\n{body}").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    fn mock_sidecar() -> Arc<Sidecar<tauri::test::MockRuntime>> {
        let app = tauri::test::mock_app();
        let settings = Arc::new(SettingsFile::new(std::env::temp_dir().join("aster-test-settings.yaml")));
        Arc::new(Sidecar::new(app.handle().clone(), settings))
    }

    async fn wait_for_status(sidecar: &Sidecar<tauri::test::MockRuntime>, state: CoreState) {
        for _ in 0..100 {
            if sidecar.status().state == state {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("status never reached {state:?}, currently {:?}", sidecar.status());
    }

    // ASTER_CORE_PATH is process-global, so the core lifecycle scenarios run
    // sequentially inside one test.
    #[tokio::test]
    async fn core_lifecycle_survives_crash_and_restart() {
        let sidecar = mock_sidecar();

        // The fake core prints a valid ready line and exits immediately:
        // the shell must converge on Error (never a lingering Ready) and
        // credentials must fail.
        std::env::set_var("ASTER_CORE_PATH", write_core_script(
            "echo '{\"type\":\"ready\",\"address\":\"127.0.0.1\",\"port\":1}'; exit 0",
        ));
        let _ = sidecar.start().await;
        wait_for_status(&sidecar, CoreState::Error).await;
        assert!(sidecar.credentials().is_err());
        let (_, reserved, _) = sidecar.debug_state();
        assert!(!reserved, "crash cleanup must release the start slot");

        // restart() must actually retry after a crash, not silently no-op:
        // the retry may parse the ready line before the process exits, but
        // the shell must converge on Error again — never a lingering Ready.
        let _ = sidecar.restart().await;
        wait_for_status(&sidecar, CoreState::Error).await;
        assert!(sidecar.credentials().is_err());

        // A healthy core reaches Ready and serves credentials; stop() lands
        // on Stopped and clears the slot for the next start.
        std::env::set_var("ASTER_CORE_PATH", write_core_script(
            "echo '{\"type\":\"ready\",\"address\":\"127.0.0.1\",\"port\":1}'; exec sleep 30",
        ));
        sidecar.start().await.unwrap();
        wait_for_status(&sidecar, CoreState::Ready).await;
        let (base_url, _) = sidecar.credentials().unwrap();
        assert_eq!(base_url, "http://127.0.0.1:1");
        sidecar.stop().await;
        wait_for_status(&sidecar, CoreState::Stopped).await;
        let (generation_after_stop, reserved, _) = sidecar.debug_state();
        assert!(!reserved);

        // A stop() during the ready window must invalidate the in-flight
        // start instead of orphaning its child: start a slow core, cancel it
        // before it prints ready, then confirm the slot is free again.
        std::env::set_var("ASTER_CORE_PATH", write_core_script(
            "sleep 5; echo '{\"type\":\"ready\",\"address\":\"127.0.0.1\",\"port\":1}'; exec sleep 30",
        ));
        let racing = Arc::clone(&sidecar);
        let in_flight = tauri::async_runtime::spawn(async move { racing.start().await });
        tokio::time::sleep(Duration::from_millis(200)).await;
        sidecar.stop().await;
        let outcome = in_flight.await.unwrap();
        assert!(outcome.is_err(), "in-flight start must fail after stop");
        let (_, reserved, _) = sidecar.debug_state();
        assert!(!reserved, "slot must be free after cancelled start");
        let _ = generation_after_stop;
    }

    #[test]
    fn parses_a_valid_ready_line() {
        let ready = parse_ready_message(r#"{"type":"ready","address":"127.0.0.1","port":54321}"#).unwrap();
        assert_eq!(ready.port, 54321);
    }

    #[test]
    fn rejects_malformed_ready_lines() {
        assert!(parse_ready_message(r#"{"type":"ready","port":0}"#).is_err());
        assert!(parse_ready_message(r#"{"type":"other","port":1234}"#).is_err());
        assert!(parse_ready_message("not json").is_err());
        assert!(parse_ready_message(r#"{"type":"ready"}"#).is_err());
    }

    #[test]
    fn resolves_the_override_first() {
        let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(executable_name());
        assert!(fallback.to_string_lossy().contains("aster-core-"));
    }
}
