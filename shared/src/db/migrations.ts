// Schema migrations for the Smart Contacts SQLite database.
// Idempotent: re-running has no effect once `meta.schema_version >= CURRENT_SCHEMA_VERSION`.
// Bump CURRENT_SCHEMA_VERSION and add a new versioned block when introducing schema changes.
import type { DbAdapter } from './adapter'

export const CURRENT_SCHEMA_VERSION = 1

const v1: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS vector_clock (
     device_id TEXT PRIMARY KEY, counter INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS contacts (
     id                  TEXT PRIMARY KEY,
     given_name          TEXT, family_name TEXT, middle_name TEXT,
     honorific_prefix    TEXT, honorific_suffix TEXT,
     phonetic_given      TEXT, phonetic_family TEXT,
     display_name        TEXT,
     nickname            TEXT,
     phones              TEXT, emails TEXT, addresses TEXT,
     events              TEXT, organizations TEXT,
     urls                TEXT, im_clients TEXT,
     relations_external  TEXT, groups TEXT,
     notes_md            TEXT, user_defined TEXT,
     locale              TEXT, gender TEXT, occupation TEXT,
     tags                TEXT,
     relations_internal  TEXT,
     custom_fields       TEXT,
     last_contacted_at   TEXT,
     preferred_channel   TEXT,
     priority            INTEGER,
     protected           INTEGER NOT NULL DEFAULT 0,
     hidden              INTEGER NOT NULL DEFAULT 0,
     social_detected     TEXT,
     reminders           TEXT,
     google_resource_name TEXT, google_etag TEXT, google_last_synced_at TEXT,
     avatar_hash         TEXT,
     created_at          TEXT NOT NULL,
     updated_at          TEXT NOT NULL,
     deleted_at          TEXT,
     lamport_ts          INTEGER NOT NULL,
     device_id           TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS contacts_did_lts ON contacts(device_id, lamport_ts)`,
  `CREATE INDEX IF NOT EXISTS contacts_display ON contacts(display_name)`,
  `CREATE INDEX IF NOT EXISTS contacts_google  ON contacts(google_resource_name)`,
  `CREATE TABLE IF NOT EXISTS custom_field_defs (
     id TEXT PRIMARY KEY, name TEXT NOT NULL,
     type TEXT NOT NULL CHECK(type IN ('text','date','number','url','boolean','select')),
     options TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
     lamport_ts INTEGER NOT NULL, device_id TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS avatars (
     contact_id TEXT PRIMARY KEY,
     blob       BLOB NOT NULL, mime TEXT NOT NULL,
     source_url TEXT, fetched_at TEXT NOT NULL, hash TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS tags_index   (name TEXT PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS groups_index (id TEXT PRIMARY KEY, name TEXT)`,
  `CREATE TABLE IF NOT EXISTS sync_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     entity TEXT, entity_id TEXT, action TEXT,
     device_id TEXT, lamport_ts INTEGER, data TEXT,
     created_at TEXT NOT NULL
   )`,
]

export async function applyMigrations(db: DbAdapter): Promise<void> {
  const rows = await db.select<{ value: string }>(
    "SELECT value FROM meta WHERE key='schema_version'",
  )
  const current = rows[0] ? Number(rows[0].value) : 0
  if (current >= CURRENT_SCHEMA_VERSION) return

  // All migration statements for every version MUST run inside this transaction,
  // and `schema_version` must be written last. Writing the version outside `tx`
  // (or before all DDL completes) risks a half-applied schema after a crash.
  await db.transaction(async (tx) => {
    if (current < 1) {
      for (const stmt of v1) await tx.execute(stmt)
    }
    const version = String(CURRENT_SCHEMA_VERSION)
    if (current === 0) {
      await tx.execute(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`, [version])
    } else {
      await tx.execute(`UPDATE meta SET value=? WHERE key='schema_version'`, [version])
    }
  })
}
