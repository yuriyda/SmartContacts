// Boots the wa-sqlite adapter, applies migrations, initialises device_id.
// Returns null until ready; consumers should branch on it.
// Rules: no React UI imports here; only DB/store logic.
//
// Lifecycle: the adapter is held in a ref so cleanup can close it on unmount
// regardless of whether init was still in flight (cancelled flag) or already
// resolved (state was set). Without the ref the post-setDb adapter would leak
// on every StrictMode double-mount and on production unmount.
import { useEffect, useRef, useState } from 'react'
import { openWaSqliteAdapter } from '@smart-contacts/shared/src/db/wa-sqlite-backend'
import {
  applyMigrations,
  initDevice,
  getDeviceId,
  makeContactsRepo,
  makeCustomFieldDefsRepo,
  makeInteractionsRepo,
  makeContactTasksRepo,
  type DbAdapter,
  type ContactsRepo,
  type CustomFieldDefsRepo,
  type InteractionsRepo,
  type ContactTasksRepo,
} from '@smart-contacts/shared'

export interface UseDbResult {
  db: DbAdapter | null
  deviceId: string | null
  contactsRepo: ContactsRepo | null
  defsRepo: CustomFieldDefsRepo | null
  interactionsRepo: InteractionsRepo | null
  tasksRepo: ContactTasksRepo | null
}

export function useDb(): UseDbResult {
  const [state, setState] = useState<UseDbResult>({
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
      const adapter = await openWaSqliteAdapter('smart-contacts')
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
