// lib.rs — Smart Contacts Tauri application entry point.
// Registers Tauri plugins: tauri-plugin-sql (SQLite), tauri-plugin-dialog, tauri-plugin-fs.
//
// Rules:
//  - Keep this file minimal — business logic belongs in the JS/React layer.
//  - SQL schema and migrations are managed by the DbAdapter in T3.
//  - No native menu: Undo/Redo are wired via keyboard shortcuts in the React layer
//    (web/SmartContactsApp.tsx → useKeyboard); Export/Import live in Settings → Backup.

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
