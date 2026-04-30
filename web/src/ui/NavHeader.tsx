/**
 * @file NavHeader.tsx
 * Top navigation bar: burger (sidebar toggle) + Contacts/Network view tabs + search input +
 * QuickEntry inline chip input + Settings cog.
 * Rules: no DB access; receives all handlers as props. The searchFocusRef is forwarded
 * from the parent so the `/` hotkey can programmatically focus the search input.
 * QuickEntry builds its own QuickEntryContext from the contacts list passed as prop.
 * activeView / onChangeView are wired to metaSettings.active_view_v1 in SmartContactsApp.
 */
import type { RefObject } from 'react'
import { useApp } from './AppContext'
import { Search, Settings as SettingsIcon } from './icons'
import { QuickEntry } from './QuickEntry'
import { Logo } from './Logo'
import { deriveLookups, type Contact, type ParsedQuickEntry } from '@smart-contacts/shared'

interface NavHeaderProps {
  contacts: Contact[]
  search: string
  onSearchChange: (v: string) => void
  onQuickAdd: (parsed: ParsedQuickEntry) => void
  onOpenFullDialog: (parsed: ParsedQuickEntry) => void
  onOpenSettings: () => void
  sidebarOpen: boolean
  onToggleSidebar: () => void
  // Forwarded ref bound to the search input for the `/` hotkey
  searchFocusRef?: RefObject<HTMLInputElement>
  // Top-bar view switcher (persisted in metaSettings.active_view_v1)
  activeView: 'contacts' | 'network'
  onChangeView: (v: 'contacts' | 'network') => void
}

export function NavHeader({
  contacts,
  search,
  onSearchChange,
  onQuickAdd,
  onOpenFullDialog,
  onOpenSettings,
  sidebarOpen: _sidebarOpen,
  onToggleSidebar,
  searchFocusRef,
  activeView,
  onChangeView,
}: NavHeaderProps) {
  const { t, TC } = useApp()
  const lookups = deriveLookups(contacts)
  const ctx = {
    tags: lookups.tags.map((tt) => tt.name),
    groups: lookups.groups.map((g) => ({ id: g.id, name: g.name })),
    contacts: contacts
      .filter((c) => !c.deletedAt)
      .map((c) => ({ id: c.id, displayName: c.displayName ?? '' })),
  }
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
      <Logo size={26} />
      <div className="flex items-center gap-1">
        {(['contacts', 'network'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChangeView(v)}
            className={[
              'px-3 py-1 rounded text-sm font-medium transition-colors',
              activeView === v ? 'bg-sky-600/20 text-sky-300' : `${TC.textSec} hover:${TC.text}`,
            ].join(' ')}
          >
            {t(`nav.tab.${v}`)}
          </button>
        ))}
      </div>
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
      <div className="w-[420px]">
        <QuickEntry
          ctx={ctx}
          onCommit={onQuickAdd}
          onTab={onOpenFullDialog}
          onCancel={() => undefined}
        />
      </div>
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
