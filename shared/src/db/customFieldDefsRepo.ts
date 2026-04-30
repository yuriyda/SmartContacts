// Custom field definitions repository for Smart Contacts.
// The ONLY module that performs SQL on the `custom_field_defs` table.
// Wraps DbAdapter and coordinates with Lamport clock bumping and row serialization.
//
// Rules:
//  - All writes (upsert, softDelete) MUST run inside db.transaction().
//  - bumpLamport logic is inlined as bumpLamportInTx() to avoid nested transactions (wa-sqlite
//    does not support SAVEPOINT; calling bumpLamport(tx, ...) would throw a nested-tx error).
//  - hardDelete is NOT exposed (defs are never tombstone-GC'd in MVP).
//  - getById returns the row whether deleted or not (caller filters by deletedAt).
//  - No raw SQL outside this file for the custom_field_defs table.
//  - No `any` types.

import type { DbAdapter } from './adapter'
import type { CustomFieldDef, Ulid } from '../types'

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
// Row mapping
// ---------------------------------------------------------------------------

/**
 * Map a raw DB row to a discriminated-union CustomFieldDef.
 * `select` type returns SelectCustomFieldDef (with options[]);
 * all other types return ScalarCustomFieldDef (no options field).
 */
function rowToDef(row: Record<string, unknown>): CustomFieldDef {
  const base = {
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string) ?? null,
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

// ---------------------------------------------------------------------------
// Valid types — must match schema CHECK constraint
// ---------------------------------------------------------------------------

const VALID_TYPES = new Set(['text', 'date', 'number', 'url', 'boolean', 'select'])

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface CustomFieldDefsRepo {
  list(): Promise<CustomFieldDef[]>
  getById(id: Ulid): Promise<CustomFieldDef | null>
  upsert(def: CustomFieldDef): Promise<CustomFieldDef>
  softDelete(id: Ulid): Promise<void>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeCustomFieldDefsRepo(db: DbAdapter, deviceId: string): CustomFieldDefsRepo {
  return {
    // ---- Queries -----------------------------------------------------------

    async list() {
      const rows = await db.select<Record<string, unknown>>(
        'SELECT * FROM custom_field_defs WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE',
      )
      return rows.map(rowToDef)
    },

    async getById(id) {
      const rows = await db.select<Record<string, unknown>>(
        'SELECT * FROM custom_field_defs WHERE id = ?',
        [id],
      )
      return rows.length > 0 ? rowToDef(rows[0]!) : null
    },

    // ---- Writes ------------------------------------------------------------

    async upsert(def) {
      // Validate type against schema CHECK constraint
      if (!VALID_TYPES.has(def.type)) {
        throw new Error(
          `Invalid custom field type: "${def.type}". Must be one of: ${[...VALID_TYPES].join(', ')}`,
        )
      }

      // Validate select def: must have non-empty options[]
      if (def.type === 'select') {
        const opts = (def as { options?: unknown }).options
        if (!Array.isArray(opts) || opts.length === 0) {
          throw new Error('select def requires non-empty options[]')
        }
      }

      return db.transaction(async (tx) => {
        const lts = await bumpLamportInTx(tx, deviceId)
        const now = new Date().toISOString()

        // For select: serialize options; for other types: always NULL (drop any accidental options)
        const optionsJson =
          def.type === 'select' ? JSON.stringify((def as { options: string[] }).options) : null

        await tx.execute(
          `INSERT OR REPLACE INTO custom_field_defs
           (id, name, type, options, created_at, updated_at, deleted_at, lamport_ts, device_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            def.id,
            def.name,
            def.type,
            optionsJson,
            def.createdAt || now,
            now,
            def.deletedAt ?? null,
            lts,
            deviceId,
          ],
        )

        const rows = await tx.select<Record<string, unknown>>(
          'SELECT * FROM custom_field_defs WHERE id = ?',
          [def.id],
        )
        return rowToDef(rows[0]!)
      })
    },

    async softDelete(id) {
      await db.transaction(async (tx) => {
        const lts = await bumpLamportInTx(tx, deviceId)
        const now = new Date().toISOString()
        await tx.execute(
          `UPDATE custom_field_defs SET deleted_at = ?, updated_at = ?, lamport_ts = ?, device_id = ? WHERE id = ?`,
          [now, now, lts, deviceId, id],
        )
      })
    },
  }
}
