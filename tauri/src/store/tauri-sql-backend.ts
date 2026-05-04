/**
 * @file tauri-sql-backend.ts
 * DbAdapter implementation for the Tauri desktop target.
 * Uses @tauri-apps/plugin-sql which talks to a native SQLite file via Rust.
 *
 * IMPORTANT — transactions are NOT supported.
 * @tauri-apps/plugin-sql v2 wraps every execute() in its own auto-transaction
 * and does not expose BEGIN/COMMIT/ROLLBACK. Issuing manual BEGIN throws
 * "cannot start a transaction within a transaction"; manual COMMIT throws
 * "no transaction is active". This matches TaskOrchestrator's known limitation
 * (see /workspace/TaskOrchestrator-main/tauri-app/src/store/helpers.ts:154).
 *
 * Therefore our `transaction()` implementation simply invokes the function;
 * each underlying statement runs in its own auto-tx. Atomicity of multi-statement
 * sequences is NOT guaranteed. Callers should rely on idempotent statements
 * (CREATE IF NOT EXISTS, INSERT OR REPLACE) so partial failures recover on retry.
 *
 * Rules for editing:
 *  - Do NOT introduce manual BEGIN/COMMIT/ROLLBACK here — they will fail at runtime.
 *  - Do NOT change the DbAdapter contract (select/execute/transaction/close).
 *  - The `close()` method delegates to Database.close(); do not suppress its errors.
 */

import Database from '@tauri-apps/plugin-sql'
import type { DbAdapter } from '@smart-contacts/shared'

export async function openTauriSqlAdapter(filename = 'smart-contacts.db'): Promise<DbAdapter> {
  const db = await Database.load(`sqlite:${filename}`)

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
      // No real transaction — plugin-sql limitation (see file header).
      // Each statement issued through `tx` runs in its own auto-tx.
      return fn(adapter)
    },

    async close(): Promise<void> {
      await db.close()
    },
  }

  return adapter
}
