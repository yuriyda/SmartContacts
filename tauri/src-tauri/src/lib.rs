// lib.rs — Smart Contacts Tauri application entry point.
// Registers Tauri plugins: tauri-plugin-sql (SQLite), tauri-plugin-dialog, tauri-plugin-fs.
// Builds the native menu (File: Export, Import, Quit; Edit: Undo, Redo, Copy, Paste).
// Menu item clicks are forwarded to the JS layer via the "smart-contacts:menu" app-wide event.
//
// Rules:
//  - Keep this file minimal — business logic belongs in the JS/React layer.
//  - SQL schema and migrations are managed by the DbAdapter in T3.
//  - The JS side listens for "smart-contacts:menu" and dispatches DOM CustomEvents.
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::Emitter;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let export_item = MenuItemBuilder::new("Export…")
                .id("export")
                .accelerator("CmdOrCtrl+E")
                .build(app)?;
            let import_item = MenuItemBuilder::new("Import…")
                .id("import")
                .accelerator("CmdOrCtrl+I")
                .build(app)?;
            let quit_item = PredefinedMenuItem::quit(app, None)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&export_item)
                .item(&import_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let undo_item = MenuItemBuilder::new("Undo")
                .id("undo")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?;
            let redo_item = MenuItemBuilder::new("Redo")
                .id("redo")
                .accelerator("CmdOrCtrl+Shift+Z")
                .build(app)?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .item(&undo_item)
                .item(&redo_item)
                .separator()
                .copy()
                .paste()
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&file_menu, &edit_menu])
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let _ = app_handle.emit("smart-contacts:menu", event.id().0.clone());
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
