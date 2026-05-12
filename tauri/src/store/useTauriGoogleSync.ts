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
//   - @tauri-apps/plugin-shell and @tauri-apps/plugin-opener are NOT in deps.
//     URL opening uses window.open as a fallback until a shell plugin is added.
//     TODO(v2): add @tauri-apps/plugin-shell and replace window.open with
//     `open(url, '_blank')` from that plugin for proper OS-default browser launch.
//   - All comments must remain in English.

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { DbAdapter } from '@smart-contacts/shared'
import { makeGoogleSyncRuntime, type GoogleSyncRuntime } from '@smart-contacts/shared'
import { makeTauriFsTokenStore } from './tauri-token-store'

// ---------------------------------------------------------------------------
// URL-open fallback
// @tauri-apps/plugin-shell and @tauri-apps/plugin-opener are not in tauri/package.json.
// TODO(v2): add one of those plugins and replace window.open with the native opener.
// ---------------------------------------------------------------------------
async function openUrlFallback(url: string): Promise<void> {
  window.open(url, '_blank')
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
      oauthOpenUrl: openUrlFallback,
    })

    setRuntime(rt)
  }, [db])

  return runtime
}
