/**
 * @file useTauriDb.ts
 * React hook that boots the Tauri SQLite adapter, applies migrations,
 * initialises device_id, and exposes all repositories.
 *
 * Returns null for all fields until the database is ready; consumers must
 * branch on the returned values before use.
 *
 * Rules:
 *  - No React UI imports here; only DB/store logic.
 *  - Mirror the shape of web/src/store/useDb.ts — diverge only where
 *    the Tauri-specific adapter requires it.
 *  - The adapter is held in a ref so cleanup can close it on unmount
 *    regardless of whether init was still in flight (cancelled flag) or
 *    already resolved (state was set). Without the ref the post-setDb
 *    adapter would leak on every StrictMode double-mount and on unmount.
 *
 * NOTE: unit tests for this hook require a real Tauri context.
 * Testing happens via `pnpm tauri dev` — see T3 task notes.
 */

import { useEffect, useRef, useState } from 'react'
import { openTauriSqlAdapter } from './tauri-sql-backend'
import {
  applyMigrations,
  initDevice,
  getDeviceId,
  makeContactsRepo,
  makeCustomFieldDefsRepo,
  makeInteractionsRepo,
  makeContactTasksRepo,
  type DbAdapter,
} from '@smart-contacts/shared'
import type { DbState } from '@smart-contacts/web'

// Re-export for backwards compat.
export type { DbState as UseTauriDbResult }

export function useTauriDb(): DbState {
  const [state, setState] = useState<DbState>({
    db: null,
    deviceId: null,
    contactsRepo: null,
    defsRepo: null,
    interactionsRepo: null,
    tasksRepo: null,
  })
  const adapterRef = useRef<DbAdapter | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const adapter = await openTauriSqlAdapter()
      adapterRef.current = adapter
      if (cancelled) return // cleanup will close it
      await applyMigrations(adapter)
      await initDevice(adapter)
      const did = await getDeviceId(adapter)
      if (cancelled) return
      setState({
        db: adapter,
        deviceId: did,
        contactsRepo: makeContactsRepo(adapter, did),
        defsRepo: makeCustomFieldDefsRepo(adapter, did),
        interactionsRepo: makeInteractionsRepo(adapter, did),
        tasksRepo: makeContactTasksRepo(adapter, did),
      })
    })()

    return () => {
      cancelled = true
      const adapter = adapterRef.current
      adapterRef.current = null
      if (adapter) void adapter.close()
    }
  }, [])

  return state
}
