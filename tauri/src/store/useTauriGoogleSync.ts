// useTauriGoogleSync.ts — React hook that wires GoogleSyncRuntime for the Tauri shell.
//
// PURPOSE: Constructs a GoogleSyncRuntime instance once the DbAdapter is ready,
//   using Tauri-specific implementations for token storage and OAuth URL opening.
//   Returns null until db is available.
//
// RO-INVARIANT: glues together GoogleSyncRuntime for the Tauri shell. No write surface.
//
// EDITING RULES:
//   - Keep construction inside useEffect so the runtime is created at most once
//     per db reference (db identity is the dep array).
//   - No cleanup needed on the runtime itself — GoogleSyncRuntime is stateless
//     between calls; the DbAdapter cleanup is owned by useTauriDb.
//   - URL opening goes through the native `open_url` Rust command (see oauth.rs)
//     to ensure the system browser is used, not a new Tauri WebView window.
//   - All comments must remain in English.

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { DbAdapter } from '@smart-contacts/shared'
import { makeGoogleSyncRuntime, type GoogleSyncRuntime } from '@smart-contacts/shared'
import { makeTauriFsTokenStore } from './tauri-token-store'

// ---------------------------------------------------------------------------
// URL-open via Tauri Rust command (delegates to OS-native opener).
// Using `window.open` inside a Tauri WebView creates a new Tauri window with
// its own IPC context, which breaks the loopback redirect flow — the system
// browser must be used so the OAuth callback hits the loopback listener in
// the same process that called `oauth_start`.
// ---------------------------------------------------------------------------
async function openUrlNative(url: string): Promise<void> {
  await invoke('open_url', { url })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Constructs and returns a GoogleSyncRuntime wired to the Tauri environment.
 * Returns null until the DbAdapter is ready.
 *
 * @param db - The initialized DbAdapter from useTauriDb; null while booting.
 */
export function useTauriGoogleSync(db: DbAdapter | null): GoogleSyncRuntime | null {
  const [runtime, setRuntime] = useState<GoogleSyncRuntime | null>(null)

  useEffect(() => {
    if (!db) {
      setRuntime(null)
      return
    }

    const tokenStore = makeTauriFsTokenStore()

    const rt = makeGoogleSyncRuntime({
      db,
      tokenStore,
      // Adapter: factory expects (cmd, args) => Promise<unknown>; invoke is compatible.
      oauthInvoke: (cmd: string, args: Record<string, unknown>) => invoke(cmd, args),
      oauthOpenUrl: openUrlNative,
    })

    setRuntime(rt)
  }, [db])

  return runtime
}
