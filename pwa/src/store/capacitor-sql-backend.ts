/**
 * @file capacitor-sql-backend.ts
 * DbAdapter implementation for the PWA mobile target on Capacitor 6.
 * Uses @capacitor-community/sqlite which talks to native SQLite via Java/Swift bridges.
 *
 * Notes:
 *  - Persistence is native (file in Android app data dir); no IndexedDB.
 *  - Transactions emulated via BEGIN/COMMIT/ROLLBACK; nested NOT supported (matches wa-sqlite + tauri parity).
 *  - The plugin returns { values: T[] } from .query() — we unwrap to a flat array.
 *
 * IMPORTANT — implicit transaction flags:
 *  - db.execute() and db.run() both accept an optional `transaction` boolean (default: true).
 *    When true, the plugin wraps each call in an implicit BEGIN/COMMIT internally.
 *  - Inside our manual transaction() wrapper we issue explicit BEGIN/COMMIT/ROLLBACK via
 *    db.execute(). If we leave the flag at its default (true), the plugin tries to open a
 *    nested transaction and SQLite raises "cannot start a transaction within a transaction".
 *  - Fix: pass `false` to suppress the implicit wrap on every db.execute/db.run call that
 *    occurs while inTransaction===true (i.e. the manual BEGIN/COMMIT lines themselves and
 *    every db.run() call dispatched from adapter.execute() during a transaction).
 *  - db.query() has no transaction flag (read-only SELECT; no implicit wrap needed).
 *  - DO NOT remove these `false` arguments — they are required for correctness.
 *
 * Rules for editing:
 *  - Do NOT change the DbAdapter contract (select/execute/transaction/close).
 *  - Do NOT add nested transaction support — no SAVEPOINT integration.
 *  - Only bind (string | number | null) params — matches our schema; Uint8Array/boolean not needed.
 */

import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite'
import type { DbAdapter } from '@smart-contacts/shared'

export async function openCapacitorSqlAdapter(name = 'smart-contacts'): Promise<DbAdapter> {
  const sqlite = new SQLiteConnection(CapacitorSQLite)

  // Ensure connection slot is fresh — defensive against hot-reload and multi-mount.
  const isConn = (await sqlite.isConnection(name, false)).result === true
  let db: SQLiteDBConnection
  if (isConn) {
    db = await sqlite.retrieveConnection(name, false)
  } else {
    db = await sqlite.createConnection(name, false, 'no-encryption', 1, false)
  }
  await db.open()

  let inTransaction = false

  const adapter: DbAdapter = {
    async select<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const res = await db.query(sql, (params ?? []) as (string | number | null)[])
      return (res.values ?? []) as T[]
    },

    async execute(sql: string, params?: unknown[]): Promise<void> {
      // Pass !inTransaction as the transaction flag:
      //   - outside a manual tx (inTransaction=false) → true → plugin auto-wraps (safe default)
      //   - inside a manual tx  (inTransaction=true)  → false → no implicit wrap; our BEGIN is active
      await db.run(sql, (params ?? []) as (string | number | null)[], !inTransaction)
    },

    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      if (inTransaction) {
        throw new Error('capacitor-sql-backend: nested transactions are not supported')
      }
      inTransaction = true
      // Pass false to suppress the plugin's implicit BEGIN/COMMIT around this statement —
      // we ARE the transaction boundary here.
      await db.execute('BEGIN TRANSACTION', false)
      try {
        const result = await fn(adapter)
        await db.execute('COMMIT', false)
        return result
      } catch (e) {
        try {
          await db.execute('ROLLBACK', false)
        } catch {
          /* ignore secondary error */
        }
        throw e
      } finally {
        inTransaction = false
      }
    },

    async close(): Promise<void> {
      await sqlite.closeConnection(name, false)
    },
  }

  return adapter
}
