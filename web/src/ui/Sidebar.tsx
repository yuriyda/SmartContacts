// Filter sidebar (placeholder content; CRUD lands in P2).
// Rules: read theme/mode from AppContext only; no direct DB access.
import { useApp } from './AppContext'
import { themes } from '@smart-contacts/shared'

export function Sidebar() {
  const { theme, mode } = useApp()
  const tc = themes.COLOR_THEMES[theme][mode]
  return (
    <aside className={`w-56 border-r ${tc.borderClass} ${tc.aside} p-3 text-sm`}>
      <div className={`${tc.textSec} uppercase tracking-wide text-xs mb-2`}>Filters</div>
      <ul className="space-y-1">
        <li className={`px-2 py-1 rounded ${tc.hoverBg}`}>All</li>
        <li className={`px-2 py-1 rounded ${tc.hoverBg}`}>Starred</li>
        <li className={`px-2 py-1 rounded ${tc.hoverBg}`}>Trash</li>
      </ul>
    </aside>
  )
}
