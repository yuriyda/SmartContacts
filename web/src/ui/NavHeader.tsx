/**
 * @file NavHeader.tsx
 * Top navigation bar: burger (sidebar toggle) + app title + search input + Add button + Settings cog.
 * Rules: no DB access; receives all handlers as props. The searchFocusRef is forwarded
 * from the parent so the `/` hotkey can programmatically focus the search input.
 */
import type { RefObject } from 'react'
import { useApp } from './AppContext'
import { Search, Settings as SettingsIcon } from './icons'

interface NavHeaderProps {
  search: string
  onSearchChange: (v: string) => void
  onAdd: () => void
  onOpenSettings: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  // Forwarded ref bound to the search input for the `/` hotkey
  searchFocusRef?: RefObject<HTMLInputElement>
}

export function NavHeader({
  search,
  onSearchChange,
  onAdd,
  onOpenSettings,
  sidebarOpen: _sidebarOpen,
  onToggleSidebar,
  searchFocusRef,
}: NavHeaderProps) {
  const { t, TC } = useApp()
  return (
    <header
      className={`flex items-center px-4 h-12 border-b ${TC.borderClass} ${TC.header} gap-3 shrink-0`}
    >
      <button
        onClick={onToggleSidebar}
        aria-label={t('nav.toggle_sidebar')}
        className={`p-1 rounded ${TC.textSec} hover:${TC.text}`}
      >
        ☰
      </button>
      <h1 className={`text-lg font-semibold ${TC.text}`}>{t('app.title')}</h1>
      <div className="flex-1 flex items-center gap-2 max-w-xl">
        <Search size={14} className={TC.textMuted} />
        <input
          ref={searchFocusRef}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('nav.search_placeholder')}
          className={`flex-1 px-3 py-1 rounded text-sm ${TC.input} ${TC.inputText}`}
        />
      </div>
      <button
        onClick={onAdd}
        className="px-3 py-1 rounded text-sm bg-sky-600 hover:bg-sky-500 text-white font-medium"
      >
        {t('nav.add_contact')}
      </button>
      <button
        onClick={onOpenSettings}
        aria-label={t('nav.settings')}
        className={`p-1 rounded ${TC.textSec} hover:${TC.text}`}
      >
        <SettingsIcon size={16} />
      </button>
    </header>
  )
}
