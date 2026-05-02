// lib.rs — Smart Contacts Tauri application entry point.
// Registers Tauri plugins: tauri-plugin-sql (SQLite) and tauri-plugin-dialog.
// In T3+ custom Tauri commands for DB migrations will be added here.
// Rules: Keep this file minimal — business logic belongs in the JS/React layer.
//        SQL schema and migrations are managed by the DbAdapter in T3.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
