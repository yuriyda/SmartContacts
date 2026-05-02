/**
 * @file dbState.ts
 * Canonical DbState interface shared between the web (wa-sqlite) and Tauri (plugin-sql)
 * persistence layers. Both useDb (web) and useTauriDb (tauri) return this shape.
 *
 * Rules:
 *  - This file must remain free of any platform-specific imports (no wa-sqlite, no tauri-apps).
 *  - Only import from @smart-contacts/shared; all repo types are defined there.
 *  - Adding fields here requires updating BOTH useDb.ts and useTauriDb.ts.
 */

import type {
  DbAdapter,
  ContactsRepo,
  CustomFieldDefsRepo,
  InteractionsRepo,
  ContactTasksRepo,
} from '@smart-contacts/shared'

/**
 * The canonical contract that both web's wa-sqlite hook and tauri's plugin-sql hook satisfy.
 * All fields are nullable until the database finishes initialising.
 */
export interface DbState {
  db: DbAdapter | null
  deviceId: string | null
  contactsRepo: ContactsRepo | null
  defsRepo: CustomFieldDefsRepo | null
  interactionsRepo: InteractionsRepo | null
  tasksRepo: ContactTasksRepo | null
}
