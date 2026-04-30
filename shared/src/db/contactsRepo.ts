// Contacts repository for Smart Contacts.
// The ONLY module that performs SQL on the `contacts` table.
// Wraps DbAdapter and coordinates with Lamport clock bumping and row serialization.
//
// Rules:
//  - All writes (upsert, softDelete, restore, touch, bulkLoad) MUST run inside db.transaction().
//  - bumpLamport logic is inlined as bumpLamportInTx() to avoid nested transactions (wa-sqlite
//    does not support SAVEPOINT; calling bumpLamport(tx, ...) would throw a nested-tx error).
//  - hardDelete does NOT bump Lamport (tombstone GC; never propagated to peers).
//  - No raw SQL outside this file for the contacts table.
//  - No `any` types.

import type { DbAdapter } from './adapter'
import type { Contact, Ulid } from '../types'
import { contactToRow, rowToContact } from './contactRow'
import { isBirthdayThisMonth } from '../core/date'

// ---------------------------------------------------------------------------
// Column metadata
// ---------------------------------------------------------------------------

const COLUMNS = [
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

type ColumnName = (typeof COLUMNS)[number]

const PLACEHOLDERS = COLUMNS.map(() => '?').join(', ')
const COL_LIST = COLUMNS.join(', ')
const UPSERT_SQL = `INSERT OR REPLACE INTO contacts (${COL_LIST}) VALUES (${PLACEHOLDERS})`

/** Extract ordered column values from a row object for binding to UPSERT_SQL. */
function rowParams(row: Record<string, unknown>): unknown[] {
  return COLUMNS.map((c: ColumnName) =>
    Object.prototype.hasOwnProperty.call(row, c) ? (row[c] ?? null) : null,
  )
}

// ---------------------------------------------------------------------------
// Lamport helper — must run on an already-open tx to avoid nested transactions
// ---------------------------------------------------------------------------

/**
 * Increment the Lamport counter for `deviceId` on a tx that is already open.
 * Does NOT start a new transaction (avoids nested-tx error in wa-sqlite).
 */
async function bumpLamportInTx(tx: DbAdapter, deviceId: string): Promise<number> {
  const rows = await tx.select<{ counter: number }>(
    'SELECT counter FROM vector_clock WHERE device_id = ?',
    [deviceId],
  )
  const next = (rows[0]?.counter ?? 0) + 1
  await tx.execute(
    `INSERT INTO vector_clock (device_id, counter) VALUES (?, ?)
     ON CONFLICT(device_id) DO UPDATE SET counter = excluded.counter`,
    [deviceId, next],
  )
  return next
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ContactsRepo {
  list(opts?: { includeDeleted?: boolean }): Promise<Contact[]>
  getById(id: Ulid): Promise<Contact | null>
  upsert(c: Contact): Promise<Contact>
  softDelete(id: Ulid): Promise<void>
  restore(id: Ulid): Promise<void>
  hardDelete(id: Ulid): Promise<void>
  touch(id: Ulid): Promise<void>
  searchByName(query: string): Promise<Contact[]>
  countAlive(): Promise<number>
  recentByLastContacted(limit: number): Promise<Contact[]>
  birthdaysThisMonth(today?: Date): Promise<Contact[]>
  bulkLoad(contacts: Contact[]): Promise<void>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeContactsRepo(db: DbAdapter, deviceId: string): ContactsRepo {
  return {
    // ---- Queries -----------------------------------------------------------

    async list(opts) {
      const where = opts?.includeDeleted ? '' : 'WHERE deleted_at IS NULL'
      const rows = await db.select<Record<string, unknown>>(
        `SELECT * FROM contacts ${where} ORDER BY display_name COLLATE NOCASE`,
      )
      return rows.map(rowToContact)
    },

    async getById(id) {
      const rows = await db.select<Record<string, unknown>>('SELECT * FROM contacts WHERE id = ?', [
        id,
      ])
      return rows.length > 0 ? rowToContact(rows[0]!) : null
    },

    async searchByName(query) {
      // SQLite's built-in LIKE / lower() only handles ASCII case folding.
      // To support Unicode (e.g. Cyrillic), we pull all alive contacts and
      // filter in JS using toLocaleLowerCase(). This is a full-table scan but
      // acceptable for a personal contacts app (typically < 10k rows).
      const needle = query.toLocaleLowerCase()
      const rows = await db.select<Record<string, unknown>>(
        'SELECT * FROM contacts WHERE deleted_at IS NULL ORDER BY display_name COLLATE NOCASE',
      )
      const contacts = rows.map(rowToContact)
      const matched = contacts.filter((c) => {
        const haystack = [c.displayName, c.givenName, c.familyName, c.nickname]
          .filter(Boolean)
          .join('\0')
          .toLocaleLowerCase()
        return haystack.includes(needle)
      })
      // Enforce limit of 50.
      return matched.slice(0, 50)
    },

    async countAlive() {
      const rows = await db.select<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM contacts WHERE deleted_at IS NULL',
      )
      return rows[0]?.cnt ?? 0
    },

    async recentByLastContacted(limit) {
      const rows = await db.select<Record<string, unknown>>(
        `SELECT * FROM contacts
         WHERE last_contacted_at IS NOT NULL AND deleted_at IS NULL
         ORDER BY last_contacted_at DESC
         LIMIT ?`,
        [limit],
      )
      return rows.map(rowToContact)
    },

    async birthdaysThisMonth(today) {
      // Pull all alive contacts, then filter in JS using the shared helper.
      const rows = await db.select<Record<string, unknown>>(
        'SELECT * FROM contacts WHERE deleted_at IS NULL',
      )
      const contacts = rows.map(rowToContact)
      return contacts.filter((c) =>
        (c.events ?? []).some(
          (ev) => ev.type === 'birthday' && isBirthdayThisMonth(ev.date, today),
        ),
      )
    },

    // ---- Writes ------------------------------------------------------------

    async upsert(c) {
      return db.transaction(async (tx) => {
        const lts = await bumpLamportInTx(tx, deviceId)
        const now = new Date().toISOString()
        const next: Contact = {
          ...c,
          createdAt: c.createdAt || now,
          updatedAt: now,
          lamportTs: lts,
          deviceId,
        }
        const row = contactToRow(next)
        await tx.execute(UPSERT_SQL, rowParams(row))
        return next
      })
    },

    async softDelete(id) {
      await db.transaction(async (tx) => {
        const lts = await bumpLamportInTx(tx, deviceId)
        const now = new Date().toISOString()
        await tx.execute(
          `UPDATE contacts SET deleted_at = ?, updated_at = ?, lamport_ts = ?, device_id = ? WHERE id = ?`,
          [now, now, lts, deviceId, id],
        )
      })
    },

    async restore(id) {
      await db.transaction(async (tx) => {
        const lts = await bumpLamportInTx(tx, deviceId)
        const now = new Date().toISOString()
        await tx.execute(
          `UPDATE contacts SET deleted_at = NULL, updated_at = ?, lamport_ts = ?, device_id = ? WHERE id = ?`,
          [now, lts, deviceId, id],
        )
      })
    },

    async hardDelete(id) {
      // Does NOT bump Lamport — this is tombstone GC, never propagated.
      await db.execute('DELETE FROM contacts WHERE id = ?', [id])
    },

    async touch(id) {
      await db.transaction(async (tx) => {
        const lts = await bumpLamportInTx(tx, deviceId)
        const now = new Date().toISOString()
        await tx.execute(
          `UPDATE contacts SET last_contacted_at = ?, updated_at = ?, lamport_ts = ?, device_id = ? WHERE id = ?`,
          [now, now, lts, deviceId, id],
        )
      })
    },

    async bulkLoad(contacts) {
      await db.transaction(async (tx) => {
        for (const c of contacts) {
          const lts = await bumpLamportInTx(tx, deviceId)
          const now = new Date().toISOString()
          const next: Contact = {
            ...c,
            createdAt: c.createdAt || now,
            updatedAt: now,
            lamportTs: lts,
            deviceId,
          }
          const row = contactToRow(next)
          await tx.execute(UPSERT_SQL, rowParams(row))
        }
      })
    },
  }
}
