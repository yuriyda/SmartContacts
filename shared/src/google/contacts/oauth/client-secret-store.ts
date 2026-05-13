// Runtime storage for Google OAuth client_secret in the meta table.
//
// RO-INVARIANT: client_secret for Google Desktop OAuth clients is not really confidential
// (RFC 8252 acknowledges this) but Google's token endpoint requires it. Stored next to
// client_id in meta table.
//
// EDITING RULES:
// - META_KEY must match the key used in factory.ts (google_contacts.oauth_client_secret).
// - Do NOT embed the secret in source, .env, or any binary artifact.
// - All comments must remain in English.

import type { DbAdapter } from '../../../db/adapter'

const META_KEY = 'google_contacts.oauth_client_secret'

export interface ClientSecretStore {
  get(): Promise<string | null>
  set(value: string): Promise<void>
  clear(): Promise<void>
}

export function makeClientSecretStore(db: DbAdapter): ClientSecretStore {
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
