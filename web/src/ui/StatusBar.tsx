// Bottom status bar: contacts count, sync state placeholder, theme/mode toggles.
// Rules: only re-queries count when db prop changes; locale from AppContext.
import { useEffect, useState } from 'react'
import type { DbAdapter } from '@smart-contacts/shared'
import { themes, i18n } from '@smart-contacts/shared'
import { useApp } from './AppContext'

export function StatusBar({ db }: { db: DbAdapter | null }) {
  const { theme, mode, locale, setMode, setTheme } = useApp()
  const tc = themes.COLOR_THEMES[theme][mode]
  const [count, setCount] = useState(0)
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
    <footer
      className={`flex items-center justify-between px-4 h-8 border-t ${tc.borderClass} ${tc.header} text-xs`}
    >
      <span className={tc.textSec}>{i18n.t(locale, 'status.contacts', { count })}</span>
      <span className="space-x-3">
        <button
          onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
          className={tc.textSec}
          aria-label="toggle theme mode"
        >
          {mode === 'dark' ? '☀' : '☾'}
        </button>
        <button
          onClick={() => setTheme(theme === 'default' ? 'gruvbox' : 'default')}
          className={tc.textSec}
          aria-label="toggle color theme"
        >
          theme
        </button>
      </span>
    </footer>
  )
}
