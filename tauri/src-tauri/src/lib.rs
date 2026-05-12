// lib.rs — Smart Contacts Tauri application entry point.
// Registers Tauri plugins: tauri-plugin-sql (SQLite), tauri-plugin-dialog, tauri-plugin-fs.
// Also registers OAuth loopback commands (oauth::oauth_start, oauth::oauth_await_code).
//
// Rules:
//  - Keep this file minimal — business logic belongs in the JS/React layer.
//  - SQL schema and migrations are managed by the DbAdapter in T3.
//  - No native menu: Undo/Redo are wired via keyboard shortcuts in the React layer
//    (web/SmartContactsApp.tsx → useKeyboard); Export/Import live in Settings → Backup.

mod oauth;

pub fn run() {
    tauri::Builder::default()
        .manage(oauth::OAuthListeners::default())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            oauth::oauth_start,
            oauth::oauth_await_code
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
