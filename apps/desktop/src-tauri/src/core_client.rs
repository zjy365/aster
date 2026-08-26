use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use futures_util::Stream;
use serde_json::Value;

/// Resolves fresh sidecar credentials per request. Implemented by Sidecar in
/// the app and by static fixtures in tests.
pub trait CredentialProvider: Send + Sync {
    fn credentials(&self) -> Result<(String, String), String>;
}

impl<R: tauri::Runtime> CredentialProvider for crate::sidecar::Sidecar<R> {
    fn credentials(&self) -> Result<(String, String), String> {
        crate::sidecar::Sidecar::credentials(self)
    }
}

/// HTTP transport to the Go sidecar. Holds no token or URL itself; every
/// request resolves fresh credentials so a sidecar restart cannot strand
/// callers with a stale bearer token.
pub struct CoreClient {
    provider: Arc<dyn CredentialProvider>,
    http: reqwest::Client,
    /// Long-running mutations (helm upgrade/rollback re-apply manifests and
    /// legitimately take minutes; the core caps helm operations at five
    /// minutes). A 30s cap would abort them client-side while the core keeps
    /// running, so they get their own client with headroom past that cap.
    http_long: reqwest::Client,
    /// No total timeout: streaming endpoints stay open until cancelled.
    http_stream: reqwest::Client,
}

impl CoreClient {
    pub fn new(provider: Arc<dyn CredentialProvider>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("reqwest client builds with rustls");
        let http_long = reqwest::Client::builder()
            .timeout(Duration::from_secs(6 * 60))
            .build()
            .expect("reqwest client builds with rustls");
        let http_stream = reqwest::Client::builder()
            .build()
            .expect("reqwest client builds with rustls");
        Self { provider, http, http_long, http_stream }
    }

    pub async fn get(&self, path: &str) -> Result<Value, String> {
        self.request(&self.http, reqwest::Method::GET, path, None).await
    }

    pub async fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        self.request(&self.http, reqwest::Method::POST, path, Some(body)).await
    }

    pub async fn post_long(&self, path: &str, body: Value) -> Result<Value, String> {
        self.request(&self.http_long, reqwest::Method::POST, path, Some(body)).await
    }

    pub async fn post_stream(&self, path: &str, body: Value) -> Result<impl Stream<Item = Result<Bytes, reqwest::Error>>, String> {
        let (base_url, token) = self.provider.credentials()?;
        let response = self
            .http_stream
            .post(format!("{base_url}{path}"))
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(transport_error)?;
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            let detail: String = text.chars().take(500).collect();
            return Err(format!("Stream request failed ({status}): {detail}"));
        }
        Ok(response.bytes_stream())
    }

    async fn request(&self, client: &reqwest::Client, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
        let (base_url, token) = self.provider.credentials()?;
        let mut request = client.request(method, format!("{base_url}{path}")).bearer_auth(token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(transport_error)?;
        let status = response.status();
        let value: Value = response.json().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            let message = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .or_else(|| value.get("message").and_then(Value::as_str))
                .map(str::to_string)
                .unwrap_or_else(|| format!("Core request failed ({status})"));
            return Err(message);
        }
        Ok(value)
    }
}

/// reqwest's Display embeds the request URL; the sidecar loopback address is
/// shell-internal and must not reach the renderer.
fn transport_error(error: reqwest::Error) -> String {
    error.without_url().to_string()
}

/// Percent-encodes a query parameter value (unreserved characters pass through).
pub fn url_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => encoded.push(byte as char),
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_encode_leaves_unreserved_and_escapes_the_rest() {
        assert_eq!(url_encode("abc-DEF_123.~"), "abc-DEF_123.~");
        assert_eq!(url_encode("a b/c=d"), "a%20b%2Fc%3Dd");
    }
}
