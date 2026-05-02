/**
 * @file index.ts
 * Public barrel for @smart-contacts/web package.
 * Re-exports the top-level app components and shared types so Tauri and
 * other consumers can import from "@smart-contacts/web" directly.
 *
 * Rules: Only export components/types that are intentionally part of the
 * cross-package API. Internal implementation details stay unexported.
 */

export { SmartContactsApp, SmartContactsShell } from './SmartContactsApp'
export type { DbState } from './store/dbState'
