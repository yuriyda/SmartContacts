// oauth.rs — Google OAuth loopback listener commands for Smart Contacts.
//
// PURPOSE: Implements the Tauri-side of the OAuth 2.0 loopback flow:
//   1. `oauth_start`      — binds a random loopback port, stores the TcpListener
//                           keyed by the CSRF `state` string, and returns the port
//                           so JS can build the redirect_uri.
//   2. `oauth_await_code` — waits (up to 5 min) for the browser to POST back to
//                           the loopback port, validates the `state` CSRF token,
//                           writes a success page, and returns the authorization code.
//
// RO-INVARIANT tag: L1.x state-bridging — these commands bridge OAuth browser flow
//   to Tauri; they MUST NOT write any data to the database or call external APIs.
//
// Rules / restrictions:
//   - Do NOT add database calls here — this module is stateless beyond the in-flight listener.
//   - The CSRF `state` check in `oauth_await_code` is security-critical; do not remove it.
//   - Only one in-flight OAuth flow is expected in Phase 1, but the HashMap supports
//     future multi-account flows without API changes.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::Mutex;

use tauri::State;

// ---------------------------------------------------------------------------
// Managed state — holds pending TCP listeners keyed by CSRF state string.
// Registered in lib.rs via `.manage(OAuthListeners::default())`.
// ---------------------------------------------------------------------------

pub struct OAuthListeners(pub Mutex<HashMap<String, TcpListener>>);

impl Default for OAuthListeners {
    fn default() -> Self {
        OAuthListeners(Mutex::new(HashMap::new()))
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Bind a free loopback port and store the listener keyed by `state`.
/// Returns the port number so JS can construct `redirect_uri=http://127.0.0.1:<port>`.
///
/// If a listener for the same `state` already exists it is replaced (dropped),
/// which releases the old port.
#[tauri::command]
pub fn oauth_start(
    state: String,
    listeners: State<'_, OAuthListeners>,
) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let mut guard = listeners.0.lock().map_err(|e| e.to_string())?;
    guard.insert(state, listener);

    Ok(port)
}

/// Wait for the OAuth redirect on the listener previously created by `oauth_start`.
///
/// Blocks up to 5 minutes for the browser redirect.  On success the listener is
/// removed from the map, the authorization `code` is returned and a "Connected."
/// HTML page is sent back to the browser.
///
/// Errors:
///   - `"OAUTH_NO_LISTENER"` — `oauth_start` was not called for this `state`.
///   - `"OAUTH_TIMEOUT"`     — 5-minute deadline exceeded with no redirect.
///   - `"OAUTH_STATE_MISMATCH"` — `state` in the query string does not match.
///   - `"OAUTH_NO_CODE"` — redirect arrived but contained no `code` parameter.
#[tauri::command]
pub async fn oauth_await_code(
    state: String,
    listeners: State<'_, OAuthListeners>,
) -> Result<String, String> {
    // Pull the listener out of the map — once we start waiting it belongs to this call.
    let listener = {
        let mut guard = listeners.0.lock().map_err(|e| e.to_string())?;
        guard
            .remove(&state)
            .ok_or_else(|| "OAUTH_NO_LISTENER".to_string())?
    };

    let expected_state = state.clone();

    tokio::time::timeout(
        std::time::Duration::from_secs(300), // 5-minute deadline
        tokio::task::spawn_blocking(move || -> Result<String, String> {
            // Ensure accept() is blocking (default, but be explicit after any earlier calls).
            listener.set_nonblocking(false).map_err(|e| e.to_string())?;

            let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
            let mut reader =
                BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);

            // Read only the request line; we don't need headers.
            let mut request_line = String::new();
            reader
                .read_line(&mut request_line)
                .map_err(|e| e.to_string())?;

            // Parse path from "GET /?code=XXX&state=YYY HTTP/1.1"
            let path = request_line
                .split_whitespace()
                .nth(1)
                .unwrap_or("");

            let query = path.splitn(2, '?').nth(1).unwrap_or("");

            // Extract code and state from query string using url::form_urlencoded.
            let params: HashMap<String, String> =
                url::form_urlencoded::parse(query.as_bytes())
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect();

            // CSRF check — state in redirect MUST match the token we issued.
            let redirect_state = params
                .get("state")
                .map(|s| s.as_str())
                .unwrap_or("");
            if redirect_state != expected_state {
                return Err("OAUTH_STATE_MISMATCH".to_string());
            }

            let code = params
                .get("code")
                .cloned()
                .ok_or_else(|| "OAUTH_NO_CODE".to_string())?;

            // Send a minimal success page so the browser tab shows something useful.
            let body = "<html><body>\
                         <h1>Connected.</h1>\
                         <p>You can close this tab.</p>\
                         </body></html>";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).ok();
            stream.flush().ok();

            Ok(code)
        }),
    )
    .await
    .map_err(|_| "OAUTH_TIMEOUT".to_string())? // timeout elapsed
    .map_err(|e| e.to_string())? // spawn_blocking JoinError
}

/// Open a URL in the user's default system browser.
///
/// `window.open()` inside the Tauri WebView creates a NEW Tauri window with its
/// own IPC context; we want the system browser so the OAuth loopback redirect
/// stays in the user's normal browser session (cookies, password manager, etc.)
/// and the WebView's IPC context isn't disrupted.
///
/// Platform-specific spawn:
///   - Windows: `rundll32 url.dll,FileProtocolHandler <url>` — passes the URL as
///              a single argv entry; `cmd /C start "" <url>` was buggy because
///              cmd.exe interprets `&` in the URL as a command separator,
///              truncating OAuth URLs after the first query parameter.
///   - macOS:   `open <url>`
///   - Linux:   `xdg-open <url>`
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
