// Backup and restore module for Smart Contacts.
// Provides lossless JSON export (BackupBundle) and two import modes:
//   - 'replace': wipe all tables, then bulk-insert the bundle as-is (no Lamport bumping).
//   - 'merge': Lamport-aware merge per-record; last-write-wins for meta keys.
//
// ExportOptions.includeHidden controls whether hidden contacts appear in the export bundle.
// Default is false (hidden contacts are excluded); pass { includeHidden: true } for full export.
//
// ExportOptions.idsFilter, when provided, restricts the exported contacts to only those whose
// id is in the set. Both filters are applied together (intersection).
//
// Rules:
//  - All importBackup writes MUST run inside db.transaction().
//  - version !== 1 is rejected before any DB access.
//  - contactToRow / rowToContact handle contacts serialization.
//  - defToRow / rowToDef (private) handle custom_field_defs serialization.
//  - No `any` types outside JSON.parse internals.
//  - No cross-coupling with contactsRepo or customFieldDefsRepo at runtime —
//    only shared types and contactRow mappers are imported.

import type { DbAdapter } from './adapter'
import type { Contact, CustomFieldDef } from '../types'
import { contactToRow, rowToContact } from './contactRow'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Options controlling what is included in the exported bundle. */
export interface ExportOptions {
  /** When true, hidden contacts are included in the export. Default: false. */
  includeHidden?: boolean
  /**
   * When set, only contacts whose id is in this set are exported.
   * Applied in addition to the includeHidden filter (intersection).
   */
  idsFilter?: ReadonlySet<string>
}

export interface BackupBundle {
  version: 1
  exportedAt: string
  device_id: string
  contacts: Contact[]
  customFieldDefs: CustomFieldDef[]
  vectorClock: Record<string, number>
  meta: Record<string, string>
}

// ---------------------------------------------------------------------------
// Private: custom_field_defs row mapper (kept here to avoid cross-coupling)
// ---------------------------------------------------------------------------

/** Decode a raw DB row into a CustomFieldDef. */
function rowToDef(row: Record<string, unknown>): CustomFieldDef {
  const base = {
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string | null | undefined) ?? null,
    lamportTs: row.lamport_ts as number,
    deviceId: row.device_id as string,
  }
  const type = row.type as string
  if (type === 'select') {
    const options = row.options ? (JSON.parse(row.options as string) as string[]) : []
    return { ...base, type: 'select', options }
  }
  return { ...base, type: type as 'text' | 'date' | 'number' | 'url' | 'boolean' }
}

/** Encode a CustomFieldDef into a flat row for INSERT. */
function defToRow(def: CustomFieldDef): {
  id: string
  name: string
  type: string
  options: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  lamport_ts: number
  device_id: string
} {
  const optionsJson =
    def.type === 'select' ? JSON.stringify((def as { options: string[] }).options) : null
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    options: optionsJson,
    created_at: def.createdAt,
    updated_at: def.updatedAt,
    deleted_at: def.deletedAt ?? null,
    lamport_ts: def.lamportTs,
    device_id: def.deviceId,
  }
}

// ---------------------------------------------------------------------------
// Column helpers for contacts INSERT (reuse COLUMNS ordering from contactsRepo)
// ---------------------------------------------------------------------------

const CONTACT_COLUMNS = [
  'id',
  'given_name',
  'family_name',
  'middle_name',
  'honorific_prefix',
  'honorific_suffix',
  'phonetic_given',
  'phonetic_family',
  'display_name',
  'nickname',
  'phones',
  'emails',
  'addresses',
  'events',
  'organizations',
  'urls',
  'im_clients',
  'relations_external',
  'groups',
  'notes_md',
  'user_defined',
  'locale',
  'gender',
  'occupation',
  'tags',
  'relations_internal',
  'custom_fields',
  'last_contacted_at',
  'preferred_channel',
  'priority',
  'social_detected',
  'reminders',
  'google_resource_name',
  'google_etag',
  'google_last_synced_at',
  'avatar_hash',
  'created_at',
  'updated_at',
  'deleted_at',
  'lamport_ts',
  'device_id',
] as const

const CONTACT_PLACEHOLDERS = CONTACT_COLUMNS.map(() => '?').join(', ')
const CONTACT_COL_LIST = CONTACT_COLUMNS.join(', ')
const CONTACT_UPSERT_SQL = `INSERT OR REPLACE INTO contacts (${CONTACT_COL_LIST}) VALUES (${CONTACT_PLACEHOLDERS})`

function contactRowParams(row: Record<string, unknown>): unknown[] {
  return CONTACT_COLUMNS.map((c) =>
    Object.prototype.hasOwnProperty.call(row, c) ? (row[c] ?? null) : null,
  )
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Export all data from the database into a portable JSON bundle. */
export async function exportBackup(db: DbAdapter, opts?: ExportOptions): Promise<BackupBundle> {
  // SELECT all contacts including deleted (lossless backup).
  const contactRows = await db.select<Record<string, unknown>>('SELECT * FROM contacts')
  // Filter hidden contacts unless explicitly included via opts.
  // Apply idsFilter when provided (intersection with includeHidden filter).
  const contacts = contactRows
    .map(rowToContact)
    .filter((c) => opts?.includeHidden || !c.hidden)
    .filter((c) => !opts?.idsFilter || opts.idsFilter.has(c.id))

  // SELECT all custom field defs including deleted.
  const defRows = await db.select<Record<string, unknown>>('SELECT * FROM custom_field_defs')
  const customFieldDefs = defRows.map(rowToDef)

  // SELECT vector clock.
  const clockRows = await db.select<{ device_id: string; counter: number }>(
    'SELECT device_id, counter FROM vector_clock',
  )
  const vectorClock: Record<string, number> = {}
  for (const r of clockRows) {
    vectorClock[r.device_id] = r.counter
  }

  // SELECT meta.
  const metaRows = await db.select<{ key: string; value: string }>('SELECT key, value FROM meta')
  const meta: Record<string, string> = {}
  for (const r of metaRows) {
    meta[r.key] = r.value
  }

  // Read device_id from meta (or empty string if absent).
  const device_id = meta['device_id'] ?? ''

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    device_id,
    contacts,
    customFieldDefs,
    vectorClock,
    meta,
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export async function importBackup(
  db: DbAdapter,
  bundle: BackupBundle,
  mode: 'merge' | 'replace',
): Promise<{ inserted: number; updated: number; skipped: number }> {
  // Validate version before any DB write.
  if (bundle.version !== 1) {
    throw new Error(`unsupported backup version: ${bundle.version}`)
  }

  let inserted = 0
  let updated = 0
  let skipped = 0

  await db.transaction(async (tx) => {
    if (mode === 'replace') {
      // Wipe all tables, then bulk-insert bundle data as-is.
      await tx.execute('DELETE FROM contacts')
      await tx.execute('DELETE FROM custom_field_defs')
      await tx.execute('DELETE FROM vector_clock')
      await tx.execute('DELETE FROM meta')

      for (const c of bundle.contacts) {
        const row = contactToRow(c)
        await tx.execute(CONTACT_UPSERT_SQL, contactRowParams(row))
        inserted++
      }

      for (const def of bundle.customFieldDefs) {
        const r = defToRow(def)
        await tx.execute(
          `INSERT OR REPLACE INTO custom_field_defs
           (id, name, type, options, created_at, updated_at, deleted_at, lamport_ts, device_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.id,
            r.name,
            r.type,
            r.options,
            r.created_at,
            r.updated_at,
            r.deleted_at,
            r.lamport_ts,
            r.device_id,
          ],
        )
      }

      for (const [deviceId, counter] of Object.entries(bundle.vectorClock)) {
        await tx.execute(`INSERT OR REPLACE INTO vector_clock (device_id, counter) VALUES (?, ?)`, [
          deviceId,
          counter,
        ])
      }

      for (const [key, value] of Object.entries(bundle.meta)) {
        await tx.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, value])
      }
    } else {
      // merge mode: Lamport-aware per-record comparison.

      // --- Contacts ---
      for (const c of bundle.contacts) {
        const existing = await tx.select<Record<string, unknown>>(
          'SELECT lamport_ts, device_id FROM contacts WHERE id = ?',
          [c.id],
        )

        if (existing.length === 0) {
          // No existing row — insert as-is.
          const row = contactToRow(c)
          await tx.execute(CONTACT_UPSERT_SQL, contactRowParams(row))
          inserted++
        } else {
          const ex = existing[0]!
          const exLts = ex['lamport_ts'] as number
          const exDid = ex['device_id'] as string

          // Accept if incoming lamport is strictly greater, or equal lamport + greater deviceId (tiebreak).
          const wins = c.lamportTs > exLts || (c.lamportTs === exLts && c.deviceId > exDid)

          if (wins) {
            const row = contactToRow(c)
            await tx.execute(CONTACT_UPSERT_SQL, contactRowParams(row))
            updated++
          } else {
            skipped++
          }
        }
      }

      // --- Custom field defs ---
      for (const def of bundle.customFieldDefs) {
        const existing = await tx.select<Record<string, unknown>>(
          'SELECT lamport_ts, device_id FROM custom_field_defs WHERE id = ?',
          [def.id],
        )

        if (existing.length === 0) {
          const r = defToRow(def)
          await tx.execute(
            `INSERT OR REPLACE INTO custom_field_defs
             (id, name, type, options, created_at, updated_at, deleted_at, lamport_ts, device_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              r.id,
              r.name,
              r.type,
              r.options,
              r.created_at,
              r.updated_at,
              r.deleted_at,
              r.lamport_ts,
              r.device_id,
            ],
          )
          inserted++
        } else {
          const ex = existing[0]!
          const exLts = ex['lamport_ts'] as number
          const exDid = ex['device_id'] as string

          const wins = def.lamportTs > exLts || (def.lamportTs === exLts && def.deviceId > exDid)

          if (wins) {
            const r = defToRow(def)
            await tx.execute(
              `INSERT OR REPLACE INTO custom_field_defs
               (id, name, type, options, created_at, updated_at, deleted_at, lamport_ts, device_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                r.id,
                r.name,
                r.type,
                r.options,
                r.created_at,
                r.updated_at,
                r.deleted_at,
                r.lamport_ts,
                r.device_id,
              ],
            )
            updated++
          } else {
            skipped++
          }
        }
      }

      // --- Vector clock: MAX(local, incoming) per device ---
      for (const [deviceId, counter] of Object.entries(bundle.vectorClock)) {
        await tx.execute(
          `INSERT INTO vector_clock (device_id, counter) VALUES (?, ?)
           ON CONFLICT(device_id) DO UPDATE SET counter = MAX(counter, excluded.counter)`,
          [deviceId, counter],
        )
      }

      // --- Meta: last-write-wins per key ---
      for (const [key, value] of Object.entries(bundle.meta)) {
        await tx.execute(
          `INSERT INTO meta (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, value],
        )
      }
    }
  })

  return { inserted, updated, skipped }
}
