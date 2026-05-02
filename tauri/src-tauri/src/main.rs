// main.rs — Tauri process entry point.
// Prevents additional console window on Windows in release — DO NOT REMOVE.
// All application logic is in lib.rs (smart_contacts_lib::run).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    smart_contacts_lib::run();
}
