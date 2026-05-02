// build.rs — Tauri code-generation step.
// Must be present and call tauri_build::build() for Tauri macros to work correctly.
// Rules: Do not add custom build logic here without careful consideration of
//        cross-compilation implications.
fn main() {
    tauri_build::build()
}
