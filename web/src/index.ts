/**
 * @file index.ts
 * Public barrel for @smart-contacts/web package.
 * Re-exports the top-level app component so Tauri and other consumers
 * can import from "@smart-contacts/web" directly.
 *
 * Rules: Only export components/types that are intentionally part of the
 * cross-package API. Internal implementation details stay unexported.
 */

export { SmartContactsApp } from './SmartContactsApp'
