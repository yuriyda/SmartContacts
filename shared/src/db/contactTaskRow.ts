// Row mapper for the `contact_tasks` SQLite table.
// Converts between ContactTask (TS, camelCase) and flat DB rows (snake_case).
// Rules:
//   - Do NOT import runtime logic from outside this file except ContactTask type.
//   - Encoding/decoding must be lossless: rowToContactTask(contactTaskToRow(t)) deep-equals t.
//   - Required fields missing in a row cause a thrown Error (fast-fail, not silent corruption).
//   - Optional fields use omit-when-undefined pattern (key absent ↔ field undefined).
//   - priority must be 1–5 (integer); values outside that range throw.

import type { ContactTask } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Require a column in the row; throw a descriptive error if absent. */
function requireCol(row: Record<string, unknown>, col: string): unknown {
  if (!(col in row)) {
    throw new Error(`contactTaskRow: missing required column ${col}`)
  }
  return row[col]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Encode a ContactTask into a flat row matching the `contact_tasks` DDL. */
export function contactTaskToRow(t: ContactTask): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: t.id,
    contact_id: t.contactId,
    text: t.text,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    lamport_ts: t.lamportTs,
    device_id: t.deviceId,
  }
  // Optional fields: omit key when undefined (preserves round-trip under exactOptionalPropertyTypes)
  if (t.dueAt !== undefined) row['due_at'] = t.dueAt
  if (t.priority !== undefined) row['priority'] = t.priority
  if (t.doneAt !== undefined) row['done_at'] = t.doneAt
  if (t.deletedAt !== undefined) row['deleted_at'] = t.deletedAt
  return row
}

/** Decode a row from `contact_tasks` back into a ContactTask (deep-equal round-trip). */
export function rowToContactTask(row: Record<string, unknown>): ContactTask {
  // Validate required columns first (fast-fail)
  const id = requireCol(row, 'id') as string
  const contactId = requireCol(row, 'contact_id') as string
  const text = requireCol(row, 'text') as string
  const createdAt = requireCol(row, 'created_at') as string
  const updatedAt = requireCol(row, 'updated_at') as string
  const lamportTs = requireCol(row, 'lamport_ts') as number
  const deviceId = requireCol(row, 'device_id') as string

  const task: ContactTask = {
    id,
    contactId,
    text,
    createdAt,
    updatedAt,
    lamportTs,
    deviceId,
  }

  // Optional text fields: omit when key absent or null
  if ('due_at' in row && row['due_at'] != null) task.dueAt = String(row['due_at'])
  if ('done_at' in row && row['done_at'] != null) task.doneAt = String(row['done_at'])
  if ('deleted_at' in row && row['deleted_at'] != null) task.deletedAt = String(row['deleted_at'])

  // Optional priority: validate 1–5 range (fast-fail on out-of-range)
  if ('priority' in row && row['priority'] != null) {
    const p = Number(row['priority'])
    if (!Number.isInteger(p) || p < 1 || p > 5) {
      throw new Error(
        `contactTaskRow: invalid priority ${String(row['priority'])} — must be integer 1–5`,
      )
    }
    task.priority = p as 1 | 2 | 3 | 4 | 5
  }

  return task
}
