use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

/// Port of installApplicationMenu from src/main/window.ts. Command items use
/// the "cmd:" id prefix; lib.rs turns those into "app:command" events.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let choose_cluster = MenuItemBuilder::with_id("cmd:show-contexts", "Choose Cluster…")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let go_back = MenuItemBuilder::with_id("cmd:go-back", "Back to Resource List")
        .accelerator("CmdOrCtrl+[")
        .build(app)?;
    let focus_filter = MenuItemBuilder::with_id("cmd:focus-filter", "Filter Resources")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let refresh = MenuItemBuilder::with_id("cmd:refresh", "Refresh Resources")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;

    let file = {
        let builder = SubmenuBuilder::new(app, "File").item(&choose_cluster).separator();
        if cfg!(target_os = "macos") {
            builder.item(&PredefinedMenuItem::close_window(app, None)?).build()?
        } else {
            builder.item(&PredefinedMenuItem::quit(app, None)?).build()?
        }
    };
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;
    let navigate = SubmenuBuilder::new(app, "Navigate")
        .item(&go_back)
        .item(&focus_filter)
        .item(&refresh)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let mut menu = MenuBuilder::new(app);
    if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, "Aster")
            .item(&PredefinedMenuItem::about(app, None, None)?)
            .separator()
            .item(&PredefinedMenuItem::services(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, None)?)
            .item(&PredefinedMenuItem::hide_others(app, None)?)
            .item(&PredefinedMenuItem::show_all(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::quit(app, None)?)
            .build()?;
        menu = menu.item(&app_menu);
    }
    let menu = menu.items(&[&file, &edit, &navigate, &view, &window]).build()?;
    app.set_menu(menu)?;
    Ok(())
}
