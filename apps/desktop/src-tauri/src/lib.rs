mod commands;
mod core_client;
mod menu;
mod settings;
mod sidecar;
mod streams;
mod updater;
mod write_safety;

use std::sync::Arc;

use tauri::{Emitter, Manager, Position, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

pub struct AppState {
    pub sidecar: Arc<sidecar::Sidecar<tauri::Wry>>,
    pub core: Arc<core_client::CoreClient>,
    pub settings: Arc<settings::SettingsFile>,
    pub write_safety: Arc<write_safety::WriteSafety>,
    pub streams: Arc<streams::Streams>,
    pub updater: Arc<updater::Updater>,
}

/// The webview may only load app content: the custom protocols (macOS
/// `tauri://localhost`, others `http://tauri.localhost`) and the dev server.
/// Everything else would be a spoof of a trusted desktop app.
fn is_app_origin(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost"))
            || (url.host_str() == Some("127.0.0.1") && url.port() == Some(5173)),
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_menu_event(|app, event| {
            if let Some(command) = event.id().0.strip_prefix("cmd:") {
                let _ = app.emit("app:command", command);
            }
        })
        .setup(|app| {
            let settings = Arc::new(settings::SettingsFile::default_path());
            let sidecar = Arc::new(sidecar::Sidecar::new(app.handle().clone(), settings.clone()));
            let core = Arc::new(core_client::CoreClient::new(sidecar.clone()));
            let updater = updater::Updater::new(app.handle().clone());
            app.manage(AppState {
                sidecar: sidecar.clone(),
                core: core.clone(),
                settings,
                write_safety: Arc::new(write_safety::WriteSafety::default()),
                streams: Arc::new(streams::Streams::new(core)),
                updater: updater.clone(),
            });
            menu::install(app.handle())?;
            // Window parity with the retired Electron shell (window.ts):
            // overlay title bar, minimum size, and a navigation policy that
            // confines the webview to app content.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Aster")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 640.0)
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(Position::Physical(tauri::PhysicalPosition::new(17, 18)))
                .on_navigation(is_app_origin)
                .build()?;
            updater.start();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = sidecar.start().await {
                    eprintln!("Failed to start Aster core: {error}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // macOS convention: closing the window hides it; the app stays in
            // the dock and Reopen shows it again. Other platforms destroy the
            // window and exit.
            if cfg!(target_os = "macos") {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            commands::core_status,
            commands::contexts_list,
            commands::namespaces_list,
            commands::discovery_list,
            commands::resources_list,
            commands::resources_get,
            commands::resources_related,
            commands::resources_search,
            commands::metrics_pods,
            commands::pods_logs,
            commands::pods_exec,
            commands::pods_portforward_start,
            commands::pods_portforward_stop,
            commands::resources_mutate,
            commands::safety_set_read_only,
            commands::resources_watch_start,
            commands::resources_watch_stop,
            commands::pods_logs_follow_start,
            commands::pods_logs_follow_stop,
            commands::settings_get,
            commands::settings_set_kubeconfig_sources,
            commands::settings_apply_kubeconfig_sources,
            commands::settings_pick_kubeconfig_file,
            commands::settings_pick_kubeconfig_folder,
            commands::appearance_set_theme_source,
            commands::updater_state,
            commands::updater_check,
            commands::updater_download,
            commands::updater_install,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Aster")
        .run(|app, event| match event {
            tauri::RunEvent::Reopen { .. } => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            tauri::RunEvent::Exit => {
                let state = app.state::<AppState>();
                tauri::async_runtime::block_on(state.sidecar.stop());
            }
            _ => {}
        });
}
