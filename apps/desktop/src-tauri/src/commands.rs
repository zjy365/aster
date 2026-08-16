use serde_json::{json, Value};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::core_client::url_encode;
use crate::settings::{normalize_sources, AsterSettings};
use crate::sidecar::CoreStatus;
use crate::AppState;

/// Every command here mirrors one Electron IPC channel from src/main/ipc.ts.
/// The Kubernetes-facing commands are thin authenticated proxies: the body
/// arrives already shaped by the renderer adapter and is validated again by
/// the Go core (core/internal/rpc/validate.go). Write operations additionally
/// pass through the Rust-side write-safety policy — an accident guard the
/// renderer opts out of per context, not a boundary against a compromised
/// renderer (that is the CSP and navigation policy's job).
fn context_id(body: &Value) -> Result<&str, String> {
    body.get("contextId").and_then(Value::as_str).ok_or_else(|| "contextId is required".to_string())
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn core_status(state: State<'_, AppState>) -> CoreStatus {
    state.sidecar.status()
}

#[tauri::command]
pub async fn contexts_list(state: State<'_, AppState>) -> Result<Value, String> {
    state.core.get("/v1/contexts").await
}

#[tauri::command]
pub async fn namespaces_list(state: State<'_, AppState>, context_id: String) -> Result<Value, String> {
    // Follow continueToken until the list is complete: clusters can have far
    // more than one page (500) of namespaces, and the picker must see them all.
    let mut namespaces: Vec<Value> = Vec::new();
    let mut continue_token = String::new();
    for _ in 0..40 {
        let mut query = format!("contextId={}&limit=500", url_encode(&context_id));
        if !continue_token.is_empty() {
            query.push_str(&format!("&continueToken={}", url_encode(&continue_token)));
        }
        let value = state.core.get(&format!("/v1/namespaces?{query}")).await?;
        if let Some(items) = value.get("items").and_then(Value::as_array) {
            for item in items {
                let mut entry = json!({ "name": item.get("name").cloned().unwrap_or(Value::Null) });
                if let Some(status) = item.get("status") {
                    entry["status"] = status.clone();
                }
                namespaces.push(entry);
            }
        }
        match value.get("continueToken").and_then(Value::as_str) {
            Some(token) if !token.is_empty() => continue_token = token.to_string(),
            _ => return Ok(Value::Array(namespaces)),
        }
    }
    Ok(Value::Array(namespaces))
}

#[tauri::command]
pub async fn discovery_list(state: State<'_, AppState>, context_id: String) -> Result<Value, String> {
    state.core.get(&format!("/v1/discovery?contextId={}", url_encode(&context_id))).await
}

#[tauri::command]
pub async fn resources_list(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/resources/list", request).await
}

#[tauri::command]
pub async fn resources_get(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/resources/get", request).await
}

#[tauri::command]
pub async fn resources_related(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/resources/related", request).await
}

#[tauri::command]
pub async fn resources_search(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/resources/search", request).await
}

#[tauri::command]
pub async fn metrics_pods(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/metrics/pods", request).await
}

#[tauri::command]
pub async fn pods_logs(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/pods/logs", request).await
}

#[tauri::command]
pub async fn pods_exec(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.write_safety.assert_write_allowed(context_id(&request)?, "Pod exec")?;
    state.core.post("/v1/pods/exec", request).await
}

#[tauri::command]
pub async fn resources_mutate(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    let operation = request.get("operation").and_then(Value::as_str).unwrap_or("mutation");
    state.write_safety.assert_write_allowed(context_id(&request)?, &format!("Resource {operation}"))?;
    state.core.post("/v1/resources/mutate", request).await
}

#[tauri::command]
pub async fn pods_portforward_start(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.write_safety.assert_write_allowed(context_id(&request)?, "Pod port forward")?;
    state.core.post("/v1/pods/portforward", request).await
}

#[tauri::command]
pub async fn pods_portforward_stop(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/pods/portforward/stop", request).await
}

#[tauri::command]
pub fn safety_set_read_only(state: State<'_, AppState>, context_id: String, read_only: bool) -> Result<(), String> {
    if context_id.is_empty() || context_id.len() > 512 {
        return Err("contextId must be between 1 and 512 characters".to_string());
    }
    state.write_safety.set_read_only(context_id, read_only);
    Ok(())
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> AsterSettings {
    state.settings.read()
}

#[tauri::command]
pub fn settings_set_kubeconfig_sources(state: State<'_, AppState>, sources: Vec<String>) -> AsterSettings {
    let settings = AsterSettings { kubeconfig_sources: normalize_sources(sources) };
    state.settings.write(&settings);
    settings
}

#[tauri::command]
pub async fn settings_apply_kubeconfig_sources(state: State<'_, AppState>, sources: Vec<String>) -> Result<(), String> {
    let settings = AsterSettings { kubeconfig_sources: normalize_sources(sources) };
    state.settings.write(&settings);
    // Restarting the core invalidates every live stream.
    state.streams.cancel_all();
    state.sidecar.restart().await
}

#[tauri::command]
pub fn resources_watch_start(state: State<'_, AppState>, id: String, request: Value, channel: Channel<Value>) {
    state.streams.start_watch(id, request, channel);
}

#[tauri::command]
pub fn resources_watch_stop(state: State<'_, AppState>, id: String) {
    state.streams.stop_watch(&id);
}

#[tauri::command]
pub fn pods_logs_follow_start(state: State<'_, AppState>, id: String, request: Value, channel: Channel<Value>) {
    state.streams.start_logs(id, request, channel);
}

#[tauri::command]
pub fn pods_logs_follow_stop(state: State<'_, AppState>, id: String) {
    state.streams.stop_logs(&id);
}

#[tauri::command]
pub async fn settings_pick_kubeconfig_file(app: AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Add a kubeconfig file")
            .add_filter("Kubeconfig", &["yaml", "yml", "json", "config"])
            .blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(picked.and_then(|path| path.into_path().ok()).map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn settings_pick_kubeconfig_folder(app: AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title("Add a folder of kubeconfigs").blocking_pick_folder()
    })
    .await
    .map_err(|error| error.to_string())?;
    Ok(picked.and_then(|path| path.into_path().ok()).map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn appearance_set_theme_source(app: AppHandle, theme: String) -> Result<(), String> {
    let theme = match theme.as_str() {
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        "system" => None,
        _ => return Err("theme must be system, light, or dark".to_string()),
    };
    for window in app.webview_windows().values() {
        window.set_theme(theme).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn updater_state(state: State<'_, AppState>) -> crate::updater::UpdaterSnapshot {
    state.updater.current_state()
}

#[tauri::command]
pub async fn updater_check(state: State<'_, AppState>) -> Result<(), String> {
    state.updater.check().await;
    Ok(())
}

#[tauri::command]
pub async fn updater_download(state: State<'_, AppState>) -> Result<(), String> {
    state.updater.clone().download().await;
    Ok(())
}

#[tauri::command]
pub fn updater_install(state: State<'_, AppState>) {
    state.updater.install();
}
