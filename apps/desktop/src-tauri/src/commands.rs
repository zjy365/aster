use serde_json::{json, Value};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::core_client::url_encode;
use crate::settings::{normalize_sources, AsterSettings};
use crate::sidecar::CoreStatus;
use crate::AppState;

/// Every command here mirrors one Electron IPC channel from src/main/ipc.ts.
/// The Kubernetes-facing commands are thin authenticated proxies: the body
/// arrives already shaped by the renderer adapter and is validated again by
/// the Go core (core/internal/rpc/validate.go).

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn app_open_external(app: AppHandle, url: String) -> Result<(), String> {
    // External links leave the app via the system browser; https only, so a
    // compromised or buggy caller cannot hand the OS a file:// or custom
    // scheme. The renderer only ever sends its own hardcoded community URLs.
    if !url.starts_with("https://") {
        return Err("only https URLs may be opened externally".to_string());
    }
    app.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())
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
pub async fn contexts_health(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/contexts/health", request).await
}

#[tauri::command]
pub async fn sources_report(state: State<'_, AppState>) -> Result<Value, String> {
    state.core.get("/v1/sources").await
}

#[tauri::command]
pub async fn sources_rename(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/sources/rename", request).await
}

#[tauri::command]
pub async fn namespaces_list(state: State<'_, AppState>, context_id: String) -> Result<Value, String> {
    // Pull the full inventory with large pages so a 200k-namespace cluster
    // loads in ~40 requests instead of ~400. The namespace picker and the
    // command palette keep the full ordered array and filter it locally by
    // prefix (see namespace-search.ts), so an exhaustive list is the point —
    // it is loaded once on first use and never during connect. A failed page
    // degrades to whatever was already collected with truncated set.
    const MAX_PAGES: usize = 40;
    const PAGE_LIMIT: i64 = 5000;
    let mut namespaces: Vec<Value> = Vec::new();
    let mut continue_token = String::new();
    let mut truncated = false;
    for _ in 0..MAX_PAGES {
        let mut query = format!("contextId={}&limit={}", url_encode(&context_id), PAGE_LIMIT);
        if !continue_token.is_empty() {
            query.push_str(&format!("&continueToken={}", url_encode(&continue_token)));
        }
        let value = match state.core.get(&format!("/v1/namespaces?{query}")).await {
            Ok(value) => value,
            Err(_) => {
                truncated = true;
                break;
            }
        };
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
            _ => break,
        }
    }
    Ok(json!({
        "namespaces": namespaces,
        "truncated": truncated || !continue_token.is_empty(),
    }))
}

#[tauri::command]
pub async fn discovery_list(state: State<'_, AppState>, context_id: String) -> Result<Value, String> {
    state.core.get(&format!("/v1/discovery?contextId={}", url_encode(&context_id))).await
}

#[tauri::command]
pub async fn overview_get(state: State<'_, AppState>, context_id: String) -> Result<Value, String> {
    state.core.get(&format!("/v1/overview?contextId={}", url_encode(&context_id))).await
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
pub async fn workloads_logs(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/workloads/logs", request).await
}

#[tauri::command]
pub async fn pods_exec(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/pods/exec", request).await
}

#[tauri::command]
pub async fn resources_mutate(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/resources/mutate", request).await
}

#[tauri::command]
pub async fn helm_releases_list(state: State<'_, AppState>, context_id: String, namespace: String) -> Result<Value, String> {
    let url = format!("/v1/helm/releases?contextId={}&namespace={}", url_encode(&context_id), url_encode(&namespace));
    state.core.get(&url).await
}

#[tauri::command]
pub async fn helm_releases_get(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/helm/releases/get", request).await
}

#[tauri::command]
pub async fn helm_releases_uninstall(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/helm/releases/uninstall", request).await
}

#[tauri::command]
pub async fn helm_releases_rollback(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    // Rollback re-applies a stored manifest and can outlast the 30s default.
    state.core.post_long("/v1/helm/releases/rollback", request).await
}

#[tauri::command]
pub async fn helm_releases_upgrade(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    // Upgrades re-apply manifests and can outlast the 30s default.
    state.core.post_long("/v1/helm/releases/upgrade", request).await
}

#[tauri::command]
pub async fn pods_portforward_start(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/pods/portforward", request).await
}

#[tauri::command]
pub async fn pods_portforward_stop(state: State<'_, AppState>, request: Value) -> Result<Value, String> {
    state.core.post("/v1/pods/portforward/stop", request).await
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> AsterSettings {
    state.settings.read()
}

#[tauri::command]
pub fn settings_set_kubeconfig_sources(state: State<'_, AppState>, sources: Vec<String>, include_standard_chain: bool) -> AsterSettings {
    let settings = AsterSettings { kubeconfig_sources: normalize_sources(sources), include_standard_chain };
    state.settings.write(&settings);
    settings
}

#[tauri::command]
pub async fn settings_apply_kubeconfig_sources(state: State<'_, AppState>, sources: Vec<String>, include_standard_chain: bool) -> Result<(), String> {
    let settings = AsterSettings { kubeconfig_sources: normalize_sources(sources), include_standard_chain };
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
    state.streams.start_logs(id, request, channel, "/v1/pods/logs/stream");
}

#[tauri::command]
pub fn pods_logs_follow_stop(state: State<'_, AppState>, id: String) {
    state.streams.stop_logs(&id);
}

#[tauri::command]
pub fn workloads_logs_follow_start(state: State<'_, AppState>, id: String, request: Value, channel: Channel<Value>) {
    state.streams.start_logs(id, request, channel, "/v1/workloads/logs/stream");
}

#[tauri::command]
pub fn workloads_logs_follow_stop(state: State<'_, AppState>, id: String) {
    state.streams.stop_logs(&id);
}

#[tauri::command]
pub async fn settings_pick_kubeconfig_file(app: AppHandle) -> Result<Option<String>, String> {
    // No extension filter: kubeconfigs routinely have no suffix (the common
    // ~/.kube/name-admin layout) and macOS disables unfiltered files, so any
    // filter would hide exactly the files this dialog exists to select. The
    // core sniffs contents and drops non-kubeconfig picks.
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title("Add a kubeconfig file").blocking_pick_file()
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
pub async fn save_text_file(app: AppHandle, default_name: String, content: String) -> Result<Option<String>, String> {
    // Log exports are the only caller today; cap defensively so a renderer bug
    // cannot turn this into an arbitrary large-file writer.
    if content.len() > 32 << 20 {
        return Err("content exceeds the 32 MiB export limit".to_string());
    }
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title("Save file").set_file_name(&default_name).blocking_save_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(path) = picked.and_then(|path| path.into_path().ok()) else {
        return Ok(None);
    };
    std::fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
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
