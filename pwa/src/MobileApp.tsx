// Mobile single-pane shell: header, three-tab body, bottom-nav.
// Boots the wa-sqlite adapter inline (no separate hook for the PWA's tiny surface yet)
// — adapter is held in useRef so cleanup can close it on unmount/StrictMode double-mount.
import { useEffect, useRef, useState } from 'react'
import {
  openWaSqliteAdapter,
  applyMigrations,
  initDevice,
  themes,
  i18n,
  type DbAdapter,
} from '@smart-contacts/shared'

export function MobileApp() {
  const tc = themes.COLOR_THEMES.default.dark
  const [db, setDb] = useState<DbAdapter | null>(null)
  const [count, setCount] = useState(0)
  const [tab, setTab] = useState<'all' | 'starred' | 'settings'>('all')
  const adapterRef = useRef<DbAdapter | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const adapter = await openWaSqliteAdapter('smart-contacts')
      adapterRef.current = adapter
      if (cancelled) return
      await applyMigrations(adapter)
      await initDevice(adapter)
      if (cancelled) return
      setDb(adapter)
    })()
    return () => {
      cancelled = true
      const adapter = adapterRef.current
      adapterRef.current = null
      if (adapter) void adapter.close()
    }
  }, [])

  useEffect(() => {
    if (!db) return
    let cancelled = false
    void (async () => {
      const rows = await db.select<{ c: number }>(
        'SELECT COUNT(*) AS c FROM contacts WHERE deleted_at IS NULL',
      )
      if (!cancelled) setCount(Number(rows[0]?.c ?? 0))
    })()
    return () => {
      cancelled = true
    }
  }, [db])

  return (
    <div className={`h-full flex flex-col ${tc.root}`}>
      <header
        className={`flex items-center justify-between px-4 h-12 border-b ${tc.borderClass} ${tc.header}`}
      >
        <h1 className="text-lg font-semibold">Smart Contacts</h1>
        <span className={`text-xs ${tc.textSec}`}>
          {i18n.t('ru', 'status.contacts', { count })}
        </span>
      </header>
      <main className={`flex-1 p-4 ${tc.surface}`}>
        {tab === 'all' && <p className={tc.textSec}>No contacts yet. (Plan P2.)</p>}
        {tab === 'starred' && <p className={tc.textSec}>Starred — empty.</p>}
        {tab === 'settings' && <p className={tc.textSec}>Settings — Plan P2.</p>}
      </main>
      <nav className={`flex border-t ${tc.borderClass} ${tc.header}`}>
        {(['all', 'starred', 'settings'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 py-2 text-sm ${tab === k ? tc.text : tc.textSec}`}
            aria-label={`switch to ${k} tab`}
          >
            {k === 'all' ? '👤 All' : k === 'starred' ? '⭐ Starred' : '⚙ Settings'}
          </button>
        ))}
      </nav>
    </div>
  )
}
