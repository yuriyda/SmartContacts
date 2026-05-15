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

/**
 * @tauri-apps/plugin-sql v2.4 has no BLOB binding for parameterized values —
 * `JsonValue::Array` (the only shape Uint8Array / number[] can take through
 * Tauri's JSON IPC) falls through to `bind(value)` in plugins-workspace
 * plugins/sql/src/wrapper.rs ~line 116, which sqlx encodes as JSON text.
 * SQLite then stores it as TEXT via column-type affinity, defeating our
 * `blob BLOB` declaration. Tracked upstream as plugins-workspace#105 (open
 * since 2023); PR #3125 is unmerged as of 2026-05.
 *
 * Workaround: rewrite the SQL on the way in. Any Uint8Array param is replaced
 * by an inline SQLite hex literal `x'FFD8FF...'`, which sqlite parses as a
 * proper BLOB token — independent of plugin-sql's binding code. Remaining
 * (non-blob) params keep their `?` slots and pass through normally.
 *
 * Assumptions:
 *  - All `?` characters in our SQL are positional placeholders. We never
 *    write `?` inside string literals or identifiers. If that ever changes,
 *    this routine must be upgraded to a real tokenizer.
 *  - Hex literals do not require escaping.
 */
function rewriteBlobParams(
  sql: string,
  params: readonly unknown[] | undefined,
): { sql: string; params: unknown[] } {
  if (params === undefined || params.length === 0) return { sql, params: [] }

  // Fast path: no binary params → skip the rewrite cost entirely.
  let hasBlob = false
  for (let i = 0; i < params.length; i++) {
    if (params[i] instanceof Uint8Array) {
      hasBlob = true
      break
    }
  }
  if (!hasBlob) return { sql, params: [...params] }

  let out = ''
  let cursor = 0
  const remaining: unknown[] = []
  let paramIdx = 0

  while (cursor < sql.length) {
    const q = sql.indexOf('?', cursor)
    if (q === -1) {
      out += sql.slice(cursor)
      break
    }
    out += sql.slice(cursor, q)
    const p = params[paramIdx]
    if (p instanceof Uint8Array) {
      let hex = ''
      for (let i = 0; i < p.length; i++) hex += p[i]!.toString(16).padStart(2, '0')
      out += `x'${hex}'`
    } else {
      out += '?'
      remaining.push(p)
    }
    paramIdx++
    cursor = q + 1
  }
  // Carry any trailing params that have no `?` (defensive — would be a caller bug).
  while (paramIdx < params.length) remaining.push(params[paramIdx++])
  return { sql: out, params: remaining }
}

export async function openTauriSqlAdapter(filename = 'smart-contacts.db'): Promise<DbAdapter> {
  const db = await Database.load(`sqlite:${filename}`)

  const adapter: DbAdapter = {
    async select<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const { sql: rewrittenSql, params: rewrittenParams } = rewriteBlobParams(sql, params)
      // plugin-sql select<T> returns T directly (typed as Promise<T> in the lib),
      // but for array results the runtime value is T[]. We cast accordingly.
      const rows = await db.select<T[]>(rewrittenSql, rewrittenParams)
      return rows
    },

    async execute(sql: string, params?: unknown[]): Promise<void> {
      const { sql: rewrittenSql, params: rewrittenParams } = rewriteBlobParams(sql, params)
      await db.execute(rewrittenSql, rewrittenParams)
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
