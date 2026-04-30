// db-like adapter contract.
// Same shape as the `db` argument in TaskOrchestrator's tauri-app/src/store/sync.ts.
// Implementations must be transactional under `transaction()` and otherwise auto-commit per call.
// Two backends are planned: wa-sqlite over IndexedDB (browser/PWA) and @tauri-apps/plugin-sql (later).

export interface DbAdapter {
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<void>
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>
  close(): Promise<void>
}
