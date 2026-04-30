// Interactions repository for Smart Contacts.
// The ONLY module that performs SQL on the `interactions` table.
// Wraps DbAdapter and coordinates with Lamport clock bumping and row serialization.
//
// Rules:
//  - All writes (upsert, softDelete) MUST run inside db.transaction().
//  - bumpLamport logic is inlined as bumpLamportInTx() to avoid nested transactions (wa-sqlite
//    does not support SAVEPOINT; calling bumpLamport(tx, ...) would throw a nested-tx error).
//  - No raw SQL outside this file for the interactions table.
//  - No `any` types.

import type { DbAdapter } from './adapter'
import type { Interaction, Ulid } from '../types'
import { interactionToRow, rowToInteraction } from './interactionRow'

// ---------------------------------------------------------------------------
// Column metadata
// ---------------------------------------------------------------------------

const COLUMNS = [
  'id',
  'contact_id',
  'at',
  'channel',
  'note_md',
  'created_at',
  'updated_at',
  'deleted_at',
  'lamport_ts',
  'device_id',
] as const

type ColumnName = (typeof COLUMNS)[number]

const PLACEHOLDERS = COLUMNS.map(() => '?').join(', ')
const COL_LIST = COLUMNS.join(', ')
const UPSERT_SQL = `INSERT OR REPLACE INTO interactions (${COL_LIST}) VALUES (${PLACEHOLDERS})`

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

export interface InteractionsRepo {
  /** Return alive interactions for a contact, ordered by at DESC. */
  list(contactId: Ulid): Promise<Interaction[]>
  /** Insert or replace an interaction; bumps lamport_ts; returns the row with the new ts. */
  upsert(i: Interaction): Promise<Interaction>
  /** Set deleted_at on the interaction (tombstone). */
  softDelete(id: Ulid): Promise<void>
  /** Return alive interactions with at >= sinceISO across all contacts. */
  recentSince(sinceISO: string): Promise<Interaction[]>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeInteractionsRepo(db: DbAdapter, deviceId: string): InteractionsRepo {
  return {
    async list(contactId) {
      const rows = await db.select<Record<string, unknown>>(
        `SELECT * FROM interactions
         WHERE contact_id = ? AND deleted_at IS NULL
         ORDER BY at DESC`,
        [contactId],
      )
      return rows.map(rowToInteraction)
    },

    async upsert(i) {
      return db.transaction(async (tx) => {
        const lts = await bumpLamportInTx(tx, deviceId)
        const now = new Date().toISOString()
        const next: Interaction = {
          ...i,
          createdAt: i.createdAt || now,
          updatedAt: now,
          lamportTs: lts,
          deviceId,
        }
        const row = interactionToRow(next)
        await tx.execute(UPSERT_SQL, rowParams(row))
        return next
      })
    },

    async softDelete(id) {
      await db.transaction(async (tx) => {
        const lts = await bumpLamportInTx(tx, deviceId)
        const now = new Date().toISOString()
        await tx.execute(
          `UPDATE interactions SET deleted_at = ?, updated_at = ?, lamport_ts = ?, device_id = ? WHERE id = ?`,
          [now, now, lts, deviceId, id],
        )
      })
    },

    async recentSince(sinceISO) {
      const rows = await db.select<Record<string, unknown>>(
        `SELECT * FROM interactions
         WHERE deleted_at IS NULL AND at >= ?
         ORDER BY at DESC`,
        [sinceISO],
      )
      return rows.map(rowToInteraction)
    },
  }
}
