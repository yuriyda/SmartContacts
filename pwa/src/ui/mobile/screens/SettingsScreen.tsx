/**
 * @file SettingsScreen.tsx
 * Mobile settings. Minimal scope (§22.5): theme + locale + sync + demo data.
 *
 * Sync is foreground-only (§22.6). For T5 the "Sync now" button shows a message
 * indicating sync wiring is deferred (no Google OAuth on mobile yet).
 *
 * Rules:
 *  - No Network dashboard, no Hidden scope (spec §22.5).
 *  - Touch-friendly: tap targets ≥ 44px.
 *  - Uses loadDemo from @smart-contacts/shared (same path as web GeneralTab).
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { DbState } from '@smart-contacts/web'
import { useApp } from '@smart-contacts/web/ui/AppContext'

export function SettingsScreen({ dbState }: { dbState: DbState }) {
  const { theme, setTheme, mode, setMode, locale, setLocale, db, deviceId, saveMeta } = useApp()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  void dbState // dbState.db is accessed via useApp().db (same singleton)

  const onLoadDemo = async () => {
    if (!db || !deviceId) {
      setMsg('Database not ready')
      return
    }
    setBusy(true)
    try {
      const { loadDemo } = await import('@smart-contacts/shared')
      await loadDemo(db, deviceId, locale)
      await saveMeta('demo_seeded', locale)
      setMsg(`Demo contacts loaded (${locale})`)
    } catch (e) {
      setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const onSyncNow = () => {
    console.log('Sync triggered')
    setMsg('Sync requires Google sign-in (not wired on mobile yet)')
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-900 pb-20">
      <header className="sticky top-0 bg-slate-800 border-b border-slate-700 px-4 py-3 z-10">
        <h1 className="text-base font-semibold text-slate-100">Settings</h1>
      </header>
      <div className="p-4 space-y-5">
        <Section title="Appearance">
          <Row label="Theme">
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'default' | 'gruvbox')}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100"
            >
              <option value="default">Default</option>
              <option value="gruvbox">Gruvbox</option>
            </select>
          </Row>
          <Row label="Mode">
            <button
              type="button"
              onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100"
            >
              {mode === 'dark' ? 'Dark' : 'Light'}
            </button>
          </Row>
          <Row label="Language">
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as 'en' | 'ru')}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100"
            >
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
          </Row>
        </Section>

        <Section title="Sync">
          <button
            type="button"
            onClick={onSyncNow}
            className="w-full px-4 py-3 bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium rounded"
          >
            Sync now
          </button>
        </Section>

        <Section title="Demo data">
          <button
            type="button"
            onClick={() => void onLoadDemo()}
            disabled={busy}
            className="w-full px-4 py-3 bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm rounded disabled:opacity-50"
          >
            {busy ? 'Loading…' : 'Load demo contacts'}
          </button>
        </Section>

        {msg && (
          <div className="p-3 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300">
            {msg}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xs uppercase tracking-wide text-slate-400 mb-2">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-300">{label}</span>
      <div>{children}</div>
    </div>
  )
}
