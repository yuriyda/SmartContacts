// Boots the wa-sqlite adapter, applies migrations, initialises device_id.
// Returns null until ready; consumers should branch on it.
// Rules: no React UI imports here; only DB/store logic.
//
// Lifecycle: the adapter is held in a ref so cleanup can close it on unmount
// regardless of whether init was still in flight (cancelled flag) or already
// resolved (state was set). Without the ref the post-setDb adapter would leak
// on every StrictMode double-mount and on production unmount.
import { useEffect, useRef, useState } from 'react'
import {
  openWaSqliteAdapter,
  applyMigrations,
  initDevice,
  getDeviceId,
  type DbAdapter,
} from '@smart-contacts/shared'

export function useDb() {
  const [db, setDb] = useState<DbAdapter | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
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
      setDb(adapter)
      setDeviceId(did)
    })()
    return () => {
      cancelled = true
      const adapter = adapterRef.current
      adapterRef.current = null
      if (adapter) void adapter.close()
    }
  }, [])
  return { db, deviceId }
}
