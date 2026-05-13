// Schema migrations for the Smart Contacts SQLite database.
// Idempotent: re-running has no effect once `meta.schema_version >= CURRENT_SCHEMA_VERSION`.
// Bump CURRENT_SCHEMA_VERSION and add a new versioned block when introducing schema changes.
//
// Editing rules:
// - NEVER remove or alter existing versioned blocks (v1, v2, …). Append-only.
// - When adding a new version: bump CURRENT_SCHEMA_VERSION, add a new `vN: string[]` block,
//   and add `if (current < N) for (const stmt of vN) await tx.execute(stmt)` in applyMigrations.
// - All DDL statements MUST use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
//   so the migration is re-entrant after a crash mid-apply.
import type { DbAdapter } from './adapter'

export const CURRENT_SCHEMA_VERSION = 3

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
  `CREATE TABLE IF NOT EXISTS interactions (
     id          TEXT PRIMARY KEY,
     contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
     at          TEXT NOT NULL,
     channel     TEXT NOT NULL,
     note_md     TEXT,
     created_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL,
     deleted_at  TEXT,
     lamport_ts  INTEGER NOT NULL,
     device_id   TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS interactions_contact ON interactions(contact_id, at)`,
  `CREATE INDEX IF NOT EXISTS interactions_did_lts ON interactions(device_id, lamport_ts)`,
  `CREATE TABLE IF NOT EXISTS contact_tasks (
     id          TEXT PRIMARY KEY,
     contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
     text        TEXT NOT NULL,
     due_at      TEXT,
     priority    INTEGER,
     done_at     TEXT,
     created_at  TEXT NOT NULL,
     updated_at  TEXT NOT NULL,
     deleted_at  TEXT,
     lamport_ts  INTEGER NOT NULL,
     device_id   TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS contact_tasks_contact ON contact_tasks(contact_id)`,
  `CREATE INDEX IF NOT EXISTS contact_tasks_due     ON contact_tasks(due_at) WHERE done_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS contact_tasks_did_lts ON contact_tasks(device_id, lamport_ts)`,
]

// RO-INVARIANT: INV-3 (snapshot), INV-5 (conflict queue), INV-4 (labels)
// Schema version 2: Google Contacts read-only sync tables.
// All tables use CREATE TABLE IF NOT EXISTS for crash-safe re-entrancy.
const v2: string[] = [
  // Last successfully pulled Google version of each contact (merge base for 3-way merge).
  `CREATE TABLE IF NOT EXISTS google_contact_snapshots (
  google_resource_name  TEXT PRIMARY KEY,
  etag                  TEXT NOT NULL,
  update_time           TEXT NOT NULL,
  payload_json          TEXT NOT NULL,
  last_synced_at        TEXT NOT NULL
)`,
  // Pending and resolved field-level conflicts (INV-5: conflicts never auto-resolve).
  `CREATE TABLE IF NOT EXISTS sync_conflicts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id            TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  google_resource_name  TEXT NOT NULL,
  field_path            TEXT NOT NULL,
  base_value_json       TEXT,
  google_value_json     TEXT,
  local_value_json      TEXT NOT NULL,
  status                TEXT NOT NULL CHECK(status IN ('pending','resolved')),
  resolution            TEXT CHECK(resolution IN ('local','google','custom')),
  custom_value_json     TEXT,
  detected_at           TEXT NOT NULL,
  resolved_at           TEXT
)`,
  `CREATE INDEX IF NOT EXISTS sync_conflicts_contact ON sync_conflicts(contact_id)`,
  `CREATE INDEX IF NOT EXISTS sync_conflicts_status  ON sync_conflicts(status)`,
  // Google Labels (contactGroups) — read-only namespace per INV-4. Always overwritten on pull.
  `CREATE TABLE IF NOT EXISTS google_labels (
  resource_name         TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  group_type            TEXT NOT NULL CHECK(group_type IN ('system','user')),
  etag                  TEXT NOT NULL,
  last_synced_at        TEXT NOT NULL
)`,
  // Many-to-many: contacts <-> google labels. Locally read-only per INV-4.
  `CREATE TABLE IF NOT EXISTS google_label_memberships (
  contact_id            TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  label_resource_name   TEXT NOT NULL REFERENCES google_labels(resource_name) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, label_resource_name)
)`,
  `CREATE INDEX IF NOT EXISTS google_label_memberships_contact ON google_label_memberships(contact_id)`,
  `CREATE INDEX IF NOT EXISTS google_label_memberships_label   ON google_label_memberships(label_resource_name)`,
  // Audit log for Google Contacts pulls (separate from CRDT sync_log per INV-1).
  `CREATE TABLE IF NOT EXISTS google_contacts_sync_log (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id                TEXT NOT NULL,
  ts                    TEXT NOT NULL,
  event                 TEXT NOT NULL,
  level                 TEXT NOT NULL CHECK(level IN ('info','warn','error')),
  payload_json          TEXT
)`,
  `CREATE INDEX IF NOT EXISTS google_contacts_sync_log_run ON google_contacts_sync_log(run_id)`,
  `CREATE INDEX IF NOT EXISTS google_contacts_sync_log_ts  ON google_contacts_sync_log(ts)`,
  // Temporary storage for pending Google photo bytes during a photo conflict resolution.
  `CREATE TABLE IF NOT EXISTS pending_google_avatars (
  contact_id            TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  blob                  BLOB NOT NULL,
  mime                  TEXT NOT NULL,
  hash                  TEXT NOT NULL,
  fetched_at            TEXT NOT NULL
)`,
]

// Schema version 3: Google Contacts birthdays and relations columns.
// Adds two TEXT (JSON) columns to contacts for Google-sourced birthday and relation data.
// These are separate from 'events' to avoid overloading local calendar events.
// NOTE: SQLite does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
// We check PRAGMA table_info(contacts) and skip ALTER TABLE if the column already exists.
// This ensures idempotency even when the migration is re-run on a DB where meta was dropped.
async function applyV3(tx: DbAdapter): Promise<void> {
  type TableInfoRow = { name: string }
  const cols = await tx.select<TableInfoRow>('PRAGMA table_info(contacts)')
  const existing = new Set(cols.map((c) => c.name))
  if (!existing.has('google_birthdays')) {
    await tx.execute('ALTER TABLE contacts ADD COLUMN google_birthdays TEXT')
  }
  if (!existing.has('google_relations')) {
    await tx.execute('ALTER TABLE contacts ADD COLUMN google_relations TEXT')
  }
}

export async function applyMigrations(db: DbAdapter): Promise<void> {
  // On a fresh DB the `meta` table does not exist yet — different adapters react
  // differently: wa-sqlite-backend silently returns [], but @tauri-apps/plugin-sql
  // and @capacitor-community/sqlite throw "no such table: meta". Treat any
  // failure here as "current = 0" (fresh DB) — the transaction below will create
  // the meta table as part of v1.
  let current = 0
  try {
    const rows = await db.select<{ value: string }>(
      "SELECT value FROM meta WHERE key='schema_version'",
    )
    current = rows[0] ? Number(rows[0].value) : 0
  } catch {
    current = 0
  }

  // Self-healing: ALWAYS run all DDL up to CURRENT_SCHEMA_VERSION, even if
  // `schema_version` already records the target version. All v1/v2 statements
  // use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, and v3
  // checks PRAGMA table_info before ALTER. So re-running is a near-zero-cost
  // no-op when the schema is consistent, but recovers gracefully if any prior
  // migration was interrupted (or the meta row was set without the DDL
  // actually committing). We DO NOT short-circuit on `current >= TARGET` here.
  await db.transaction(async (tx) => {
    for (const stmt of v1) await tx.execute(stmt)
    for (const stmt of v2) await tx.execute(stmt)
    await applyV3(tx)
    const version = String(CURRENT_SCHEMA_VERSION)
    if (current === 0) {
      await tx.execute(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`, [version])
    } else {
      await tx.execute(`UPDATE meta SET value=? WHERE key='schema_version'`, [version])
    }
  })
}
