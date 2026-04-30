/**
 * @file Sidebar.tsx
 * Left navigation sidebar for Smart Contacts.
 * Renders scope filters (All / Starred / Recent / Birthdays / Trash), group list, and tag list.
 * Modeled after TaskOrchestrator/tauri-app/src/ui/Sidebar.tsx — Section + FilterItem pattern.
 * Rules: reads theme/density/t from AppContext only; no direct DB access.
 * Accepts contacts array for live counts and group/tag derivation.
 */
import { useState, useMemo } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { Contact } from '@smart-contacts/shared'
import { deriveLookups, isBirthdayThisMonth } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import {
  Inbox,
  Star,
  Clock,
  Cake,
  Trash2,
  Users,
  Tag,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Settings,
  X,
} from './icons'
import type { ContactFilters } from './filterTypes'
import type { SavedFilter } from './savedFilters'

interface SidebarProps {
  contacts: Contact[]
  filters: ContactFilters
  setFilter: <K extends keyof ContactFilters>(key: K, value: ContactFilters[K]) => void
  setFilters: (next: ContactFilters) => void
  resetFilters: () => void
  onOpenSettings: () => void
  savedFilters: SavedFilter[]
  onDeleteSavedFilter: (id: string) => void
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function Sidebar({
  contacts,
  filters,
  setFilter,
  setFilters,
  resetFilters,
  onOpenSettings,
  savedFilters,
  onDeleteSavedFilter,
}: SidebarProps) {
  const { TC, t, density } = useApp()

  const lookups = useMemo(() => deriveLookups(contacts), [contacts])

  const counts = useMemo(() => {
    const alive = contacts.filter((c) => !c.deletedAt)
    const cutoff = Date.now() - SEVEN_DAYS_MS
    return {
      all: alive.length,
      starred: alive.filter((c) => (c.priority ?? 5) <= 2).length,
      recent: alive.filter(
        (c) => c.lastContactedAt && new Date(c.lastContactedAt).getTime() >= cutoff,
      ).length,
      birthdays: alive.filter((c) =>
        (c.events ?? []).some((e) => e.type === 'birthday' && isBirthdayThisMonth(e.date)),
      ).length,
      trash: contacts.filter((c) => !!c.deletedAt).length,
    }
  }, [contacts])

  const [open, setOpen] = useState({ filters: true, saved: true, groups: true, tags: true })
  const toggle = (key: keyof typeof open) => setOpen((o) => ({ ...o, [key]: !o[key] }))

  const SECTION_KEYS: Array<keyof typeof open> = ['filters', 'saved', 'groups', 'tags']
  const allExpanded = SECTION_KEYS.every((k) => open[k])
  const toggleAll = () => {
    const target = !allExpanded
    setOpen({ filters: target, saved: target, groups: target, tags: target })
  }

  const itemPy = density === 'compact' ? 'py-0.5' : 'py-1.5'

  // Inline sub-components to share closure over TC, density, etc.
  function Section({
    id,
    label,
    icon: Icon,
    children,
    extra,
  }: {
    id: keyof typeof open
    label: string
    icon?: LucideIcon
    children: React.ReactNode
    extra?: React.ReactNode
  }) {
    return (
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <button onClick={() => toggle(id)} className="flex items-center gap-1.5 flex-1 group">
            <span
              className={`text-xs font-semibold uppercase tracking-wider flex-1 text-left flex items-center gap-1 ${TC.textMuted}`}
            >
              {Icon && <Icon size={12} />}
              {label}
            </span>
            <ChevronRight
              size={12}
              className={`${TC.textMuted} transition-transform duration-150 ${open[id] ? 'rotate-90' : ''}`}
            />
          </button>
          {extra}
        </div>
        {open[id] && children}
      </div>
    )
  }

  function FilterItem({
    icon: Icon,
    label,
    count,
    active,
    onClick,
  }: {
    icon: LucideIcon
    label: string
    count: number
    active: boolean
    onClick: () => void
  }) {
    return (
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-3 rounded-md text-sm transition-colors ${itemPy} ${
          active
            ? 'bg-sky-600/20 text-sky-300'
            : `${TC.textMuted} ${TC.hoverBg} hover:text-gray-200`
        }`}
      >
        <Icon size={14} className="flex-shrink-0" />
        <span className="flex-1 text-left truncate">{label}</span>
        <span className="text-xs opacity-60">{count}</span>
      </button>
    )
  }

  return (
    <aside
      className={`w-56 flex-shrink-0 border-r p-3 flex flex-col overflow-hidden ${TC.borderClass} ${TC.aside}`}
      style={{ scrollbarWidth: 'thin' }}
    >
      <div
        className={`flex-1 ${density === 'compact' ? 'space-y-2' : 'space-y-4'} overflow-y-auto`}
      >
        {/* ── Scope filters section ── */}
        <Section
          id="filters"
          label={t('sidebar.filters')}
          extra={
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleAll()
              }}
              className={`ml-auto transition-colors ${TC.textMuted} hover:text-gray-300`}
              title={allExpanded ? 'Collapse all' : 'Expand all'}
            >
              {allExpanded ? <ChevronsUp size={14} /> : <ChevronsDown size={14} />}
            </button>
          }
        >
          <div className="space-y-0.5">
            <FilterItem
              icon={Inbox}
              label={t('sidebar.all')}
              count={counts.all}
              active={filters.scope === 'all' && !filters.group && !filters.tag}
              onClick={() => {
                setFilter('scope', 'all')
                setFilter('group', null)
                setFilter('tag', null)
              }}
            />
            <FilterItem
              icon={Star}
              label={t('sidebar.starred')}
              count={counts.starred}
              active={filters.scope === 'starred'}
              onClick={() => setFilter('scope', 'starred')}
            />
            <FilterItem
              icon={Clock}
              label={t('sidebar.recent')}
              count={counts.recent}
              active={filters.scope === 'recent'}
              onClick={() => setFilter('scope', 'recent')}
            />
            <FilterItem
              icon={Cake}
              label={t('sidebar.birthdays')}
              count={counts.birthdays}
              active={filters.scope === 'birthdays'}
              onClick={() => setFilter('scope', 'birthdays')}
            />
            <FilterItem
              icon={Trash2}
              label={t('sidebar.trash')}
              count={counts.trash}
              active={filters.scope === 'trash'}
              onClick={() => setFilter('scope', 'trash')}
            />
          </div>
        </Section>

        {/* ── Saved filter presets section (hidden when list is empty) ── */}
        {savedFilters.length > 0 && (
          <Section id="saved" label={t('sidebar.saved')}>
            <div className="space-y-0.5">
              {savedFilters.map((sf) => {
                const isActive = JSON.stringify(filters) === JSON.stringify(sf.filters)
                return (
                  <div key={sf.id} className="flex items-center group">
                    <button
                      type="button"
                      onClick={() => setFilters(sf.filters)}
                      className={`flex-1 text-left px-2 py-1 rounded text-sm truncate ${
                        isActive
                          ? 'bg-sky-600/20 text-sky-300'
                          : `${TC.textMuted} hover:${TC.text} ${TC.hoverBg}`
                      }`}
                    >
                      {sf.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedFilter(sf.id)}
                      aria-label={t('actions.delete_filter')}
                      className={`opacity-0 group-hover:opacity-60 hover:opacity-100 px-1 ${TC.textMuted}`}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* ── Groups section ── */}
        <Section id="groups" label={t('sidebar.groups')} icon={Users}>
          <div className="space-y-0.5">
            {lookups.groups.length === 0 && (
              <p className={`px-3 text-xs ${TC.textMuted} py-1`}>—</p>
            )}
            {lookups.groups.map((g) => (
              <button
                key={g.id}
                onClick={() =>
                  filters.group === g.id ? setFilter('group', null) : setFilter('group', g.id)
                }
                className={`w-full flex items-center gap-2 px-3 rounded-md text-sm transition-colors ${itemPy} ${
                  filters.group === g.id
                    ? 'bg-sky-600/20 text-sky-300'
                    : `${TC.textMuted} ${TC.hoverBg} hover:text-gray-200`
                }`}
              >
                <span className="flex-1 text-left truncate">{g.name}</span>
                <span className="text-xs opacity-60">{g.count}</span>
                {filters.group === g.id && <X size={10} className="flex-shrink-0" />}
              </button>
            ))}
          </div>
        </Section>

        {/* ── Tags section ── */}
        <Section id="tags" label={t('sidebar.tags')} icon={Tag}>
          <div className="space-y-0.5">
            {lookups.tags.length === 0 && <p className={`px-3 text-xs ${TC.textMuted} py-1`}>—</p>}
            {lookups.tags.map((tg) => (
              <button
                key={tg.name}
                onClick={() =>
                  filters.tag === tg.name ? setFilter('tag', null) : setFilter('tag', tg.name)
                }
                className={`w-full flex items-center gap-2 px-3 rounded-md text-sm transition-colors ${itemPy} ${
                  filters.tag === tg.name
                    ? 'bg-sky-600/20 text-sky-300'
                    : `${TC.textMuted} ${TC.hoverBg} hover:text-gray-200`
                }`}
              >
                <span className="flex-1 text-left truncate">#{tg.name}</span>
                <span className="text-xs opacity-60">{tg.count}</span>
                {filters.tag === tg.name && <X size={10} className="flex-shrink-0" />}
              </button>
            ))}
          </div>
        </Section>
      </div>

      {/* ── Footer: reset filters + settings ── */}
      <div
        className={`py-2 mt-3 border-t flex items-center justify-between gap-1 flex-shrink-0 ${TC.borderClass}`}
      >
        <button
          onClick={resetFilters}
          className={`text-xs ${TC.textMuted} hover:text-gray-300 transition-colors`}
          title="Reset filters"
        >
          Reset
        </button>
        <button
          onClick={onOpenSettings}
          title={t('nav.settings')}
          className={`p-1.5 rounded transition-colors ${TC.textMuted} ${TC.hoverBg} hover:text-gray-200`}
        >
          <Settings size={13} />
        </button>
      </div>
    </aside>
  )
}
