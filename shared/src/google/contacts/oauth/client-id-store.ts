// Runtime storage for Google OAuth client_id in the meta table.
// client_id is not secret per RFC 8252 (Desktop app PKCE flow), but is user-specific config.
// Stored in meta table for UI-driven setup: no .env, no rebuild on change.
//
// EDITING RULES:
// - META_KEY must match the key used in factory.ts (google_contacts.oauth_client_id).
// - Do NOT add client_secret here — Desktop app PKCE flow has no secret.
// - All comments must remain in English.

import type { DbAdapter } from '../../../db/adapter'

const META_KEY = 'google_contacts.oauth_client_id'

export interface ClientIdStore {
  get(): Promise<string | null>
  set(value: string): Promise<void>
  clear(): Promise<void>
}

export function makeClientIdStore(db: DbAdapter): ClientIdStore {
  return {
    async get() {
      const rows = await db.select<{ value: string }>('SELECT value FROM meta WHERE key = ?', [
        META_KEY,
      ])
      return rows[0]?.value ?? null
    },
    async set(value: string) {
      await db.execute(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
        [META_KEY, value, value],
      )
    },
    async clear() {
      await db.execute('DELETE FROM meta WHERE key = ?', [META_KEY])
    },
  }
}
