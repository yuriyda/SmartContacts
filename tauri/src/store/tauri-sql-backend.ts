/**
 * @file tauri-sql-backend.ts
 * DbAdapter implementation for the Tauri desktop target.
 * Uses @tauri-apps/plugin-sql which talks to a native SQLite file via Rust.
 *
 * Notes:
 *  - Persistence is handled natively (file-based SQLite); no IndexedDB snapshot logic needed.
 *  - Transactions: plugin-sql v2 doesn't expose tx contexts directly. We emulate by issuing
 *    BEGIN / COMMIT / ROLLBACK manually. NESTED transactions are unsupported (same constraint
 *    as wa-sqlite-backend); enforce a flag to detect and throw.
 *  - The adapter returned from inside transaction() is the SAME object as the outer adapter —
 *    repos call it normally, queries route through the same Database connection.
 *
 * Rules for editing:
 *  - Do NOT change the DbAdapter contract (select/execute/transaction/close).
 *  - Do NOT add nested transaction support — plugin-sql has no SAVEPOINT integration.
 *  - The `close()` method delegates to Database.close(); do not suppress its errors.
 */

import Database from '@tauri-apps/plugin-sql'
import type { DbAdapter } from '@smart-contacts/shared'

export async function openTauriSqlAdapter(filename = 'smart-contacts.db'): Promise<DbAdapter> {
  const db = await Database.load(`sqlite:${filename}`)

  let inTransaction = false

  const adapter: DbAdapter = {
    async select<T>(sql: string, params?: unknown[]): Promise<T[]> {
      // plugin-sql select<T> returns T directly (typed as Promise<T> in the lib),
      // but for array results the runtime value is T[]. We cast accordingly.
      const rows = await db.select<T[]>(sql, params ?? [])
      return rows
    },

    async execute(sql: string, params?: unknown[]): Promise<void> {
      await db.execute(sql, params ?? [])
    },

    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      if (inTransaction) {
        throw new Error('tauri-sql-backend: nested transactions are not supported')
      }
      inTransaction = true
      await db.execute('BEGIN TRANSACTION')
      try {
        const result = await fn(adapter)
        await db.execute('COMMIT')
        return result
      } catch (e) {
        await db.execute('ROLLBACK').catch(() => undefined)
        throw e
      } finally {
        inTransaction = false
      }
    },

    async close(): Promise<void> {
      await db.close()
    },
  }

  return adapter
}
