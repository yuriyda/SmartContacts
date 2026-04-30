// Main contacts list area (empty until P2 adds CRUD).
// Rules: receives db as prop; no direct DB bootstrapping here.
import type { DbAdapter } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { themes } from '@smart-contacts/shared'

export function MainList({ db: _db }: { db: DbAdapter | null }) {
  const { theme, mode } = useApp()
  const tc = themes.COLOR_THEMES[theme][mode]
  return (
    <main className={`flex-1 p-6 ${tc.surface}`}>
      <p className={tc.textSec}>No contacts yet. (Plan P2 will add CRUD.)</p>
    </main>
  )
}
