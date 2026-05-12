// tauri-token-store.ts — Tauri plugin-fs implementation of the TokenStore interface.
//
// PURPOSE: Provides read/write/clear for the Google OAuth refresh token using
//   @tauri-apps/plugin-fs with BaseDirectory.AppData. The token is stored as
//   JSON in a restricted app-data file, NOT in SQLite / IndexedDB / localStorage.
//
// RO-INVARIANT: L7.1 — refresh token NOT in SQLite/IndexedDB/localStorage.
//   Phase 1 uses plugin-fs to a restricted-permissions file; v2 should upgrade
//   to plugin-stronghold or OS keyring for encryption-at-rest.
//
// EDITING RULES:
//   - Do NOT change TOKEN_FILE_PATH or BaseDirectory without migrating existing tokens.
//   - mkdir must use { recursive: true } to avoid errors on first run.
//   - All catch blocks must swallow errors — file may not exist yet (first run).
//   - All comments must remain in English.

import { readTextFile, writeTextFile, remove, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs'
import type { TokenStore } from '@smart-contacts/shared'

/** Path within AppData where the token JSON is stored. */
const TOKEN_FILE_PATH = 'smart-contacts/google-tokens.json' as const

/** Parent directory — must exist before writeTextFile. */
const TOKEN_DIR = 'smart-contacts' as const

/** Shape of the persisted JSON file. */
interface TokenFileSchema {
  refreshToken?: string
}

/**
 * Creates a TokenStore backed by @tauri-apps/plugin-fs (AppData directory).
 * Returns read/write/clear operations for the Google Contacts refresh token.
 */
export function makeTauriFsTokenStore(): TokenStore {
  return {
    async read(): Promise<string | null> {
      try {
        const text = await readTextFile(TOKEN_FILE_PATH, { baseDir: BaseDirectory.AppData })
        const obj = JSON.parse(text) as TokenFileSchema
        return obj.refreshToken ?? null
      } catch {
        // File does not exist on first run or is unreadable — return null.
        return null
      }
    },

    async write(token: string): Promise<void> {
      // Ensure parent directory exists before writing.
      await mkdir(TOKEN_DIR, { baseDir: BaseDirectory.AppData, recursive: true })
      const contents: TokenFileSchema = { refreshToken: token }
      await writeTextFile(TOKEN_FILE_PATH, JSON.stringify(contents), {
        baseDir: BaseDirectory.AppData,
      })
    },

    async clear(): Promise<void> {
      try {
        await remove(TOKEN_FILE_PATH, { baseDir: BaseDirectory.AppData })
      } catch {
        // File may not exist — ignore.
      }
    },
  }
}
