/**
 * @file useCapacitorDb.ts
 * Mobile (Capacitor) variant of useDb. Returns the same DbState shape so SmartContactsShell
 * (or any future mobile shell that consumes DbState) is platform-agnostic.
 *
 * Rules:
 *  - No React UI imports here; only DB/store logic.
 *  - Mirror the shape of web/src/store/useDb.ts — diverge only where
 *    the Capacitor-specific adapter requires it.
 *  - The adapter is held in a ref so cleanup can close it on unmount
 *    regardless of whether init was still in flight (cancelled flag) or
 *    already resolved. Without the ref the post-setDb adapter would leak
 *    on every StrictMode double-mount and on unmount.
 *
 * NOTE: unit tests for this hook require a real Capacitor/Android context.
 */

import { useEffect, useRef, useState } from 'react'
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
import { openCapacitorSqlAdapter } from './capacitor-sql-backend'

export function useCapacitorDb(): DbState {
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
      const adapter = await openCapacitorSqlAdapter()
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
