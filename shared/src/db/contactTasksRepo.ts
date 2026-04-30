// Contact tasks repository for Smart Contacts.
// The ONLY module that performs SQL on the `contact_tasks` table.
// Wraps DbAdapter and coordinates with Lamport clock bumping and row serialization.
//
// Rules:
//  - All writes (upsert, softDelete, markDone, reopen) MUST run inside db.transaction().
//  - bumpLamport logic is inlined as bumpLamportInTx() to avoid nested transactions (wa-sqlite
//    does not support SAVEPOINT; calling bumpLamport(tx, ...) would throw a nested-tx error).
//  - markDone and reopen use the fetch+upsert pattern to re-use the upsert code path.
//  - No raw SQL outside this file for the contact_tasks table.
//  - No `any` types.

import type { DbAdapter } from './adapter'
import type { ContactTask, Ulid } from '../types'
import { contactTaskToRow, rowToContactTask } from './contactTaskRow'

// ---------------------------------------------------------------------------
// Column metadata
// ---------------------------------------------------------------------------

const COLUMNS = [
  'id',
  'contact_id',
  'text',
  'due_at',
  'priority',
  'done_at',
  'created_at',
  'updated_at',
  'deleted_at',
  'lamport_ts',
  'device_id',
] as const

type ColumnName = (typeof COLUMNS)[number]

const PLACEHOLDERS = COLUMNS.map(() => '?').join(', ')
const COL_LIST = COLUMNS.join(', ')
const UPSERT_SQL = `INSERT OR REPLACE INTO contact_tasks (${COL_LIST}) VALUES (${PLACEHOLDERS})`

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

export interface ContactTasksRepo {
  /**
   * Return alive tasks for a contact.
   * Order: open tasks first (done_at IS NULL), then done;
   * within open: due_at ASC NULLS LAST, then priority ASC NULLS LAST.
   */
  list(contactId: Ulid): Promise<ContactTask[]>
  /** Return all alive open tasks (doneAt IS NULL) across all contacts. */
  listAllOpen(): Promise<ContactTask[]>
  /**
   * Return alive, open tasks with dueAt within [now, now+days].
   * Tasks without a due date are excluded.
   */
  listDueWithin(days: number): Promise<ContactTask[]>
  /** Insert or replace a task; bumps lamport_ts; returns the row with the new ts. */
  upsert(t: ContactTask): Promise<ContactTask>
  /** Set done_at; bumps lamport so peers learn about the change. */
  markDone(id: Ulid, doneAt: string): Promise<void>
  /** Clear done_at; bumps lamport so peers learn about the change. */
  reopen(id: Ulid): Promise<void>
  /** Set deleted_at on the task (tombstone). */
  softDelete(id: Ulid): Promise<void>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeContactTasksRepo(db: DbAdapter, deviceId: string): ContactTasksRepo {
  /**
   * Shared upsert logic used by the public upsert(), markDone(), and reopen().
   * Caller MUST already be inside db.transaction().
   */
  async function upsertInTx(tx: DbAdapter, t: ContactTask): Promise<ContactTask> {
    const lts = await bumpLamportInTx(tx, deviceId)
    const now = new Date().toISOString()
    const next: ContactTask = {
      ...t,
      createdAt: t.createdAt || now,
      updatedAt: now,
      lamportTs: lts,
      deviceId,
    }
    const row = contactTaskToRow(next)
    await tx.execute(UPSERT_SQL, rowParams(row))
    return next
  }

  /** Fetch a single task row by id (does not filter deleted_at). */
  async function fetchById(id: Ulid): Promise<ContactTask | null> {
    const rows = await db.select<Record<string, unknown>>(
      'SELECT * FROM contact_tasks WHERE id = ?',
      [id],
    )
    return rows.length > 0 ? rowToContactTask(rows[0]!) : null
  }

  return {
    async list(contactId) {
      const rows = await db.select<Record<string, unknown>>(
        `SELECT * FROM contact_tasks
         WHERE contact_id = ? AND deleted_at IS NULL
         ORDER BY (done_at IS NULL) DESC, due_at ASC NULLS LAST, priority ASC NULLS LAST`,
        [contactId],
      )
      return rows.map(rowToContactTask)
    },

    async listAllOpen() {
      const rows = await db.select<Record<string, unknown>>(
        `SELECT * FROM contact_tasks
         WHERE done_at IS NULL AND deleted_at IS NULL
         ORDER BY due_at ASC NULLS LAST, priority ASC NULLS LAST`,
      )
      return rows.map(rowToContactTask)
    },

    async listDueWithin(days) {
      const nowISO = new Date().toISOString()
      const cutoffISO = new Date(Date.now() + days * 86400000).toISOString()
      const rows = await db.select<Record<string, unknown>>(
        `SELECT * FROM contact_tasks
         WHERE done_at IS NULL AND deleted_at IS NULL
           AND due_at IS NOT NULL
           AND due_at >= ? AND due_at <= ?
         ORDER BY due_at ASC`,
        [nowISO, cutoffISO],
      )
      return rows.map(rowToContactTask)
    },

    async upsert(t) {
      return db.transaction(async (tx) => upsertInTx(tx, t))
    },

    async markDone(id, doneAt) {
      await db.transaction(async (tx) => {
        const existing = await fetchById(id)
        if (!existing) return
        await upsertInTx(tx, { ...existing, doneAt })
      })
    },

    async reopen(id) {
      await db.transaction(async (tx) => {
        const existing = await fetchById(id)
        if (!existing) return
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { doneAt: _removed, ...withoutDone } = existing
        await upsertInTx(tx, withoutDone)
      })
    },

    async softDelete(id) {
      await db.transaction(async (tx) => {
        const lts = await bumpLamportInTx(tx, deviceId)
        const now = new Date().toISOString()
        await tx.execute(
          `UPDATE contact_tasks SET deleted_at = ?, updated_at = ?, lamport_ts = ?, device_id = ? WHERE id = ?`,
          [now, now, lts, deviceId, id],
        )
      })
    },
  }
}
