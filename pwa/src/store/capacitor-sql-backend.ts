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
      await db.run(sql, (params ?? []) as (string | number | null)[])
    },

    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      if (inTransaction) {
        throw new Error('capacitor-sql-backend: nested transactions are not supported')
      }
      inTransaction = true
      await db.execute('BEGIN TRANSACTION')
      try {
        const result = await fn(adapter)
        await db.execute('COMMIT')
        return result
      } catch (e) {
        try {
          await db.execute('ROLLBACK')
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
