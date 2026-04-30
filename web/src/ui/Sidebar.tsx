/**
 * @file Sidebar.tsx
 * Left navigation sidebar for Smart Contacts.
 * Renders scope filters (All / Starred / Recent / Birthdays / Trash / Hidden), group list, tag list,
 * and organizations list (T3: sorted by recency, capped at 50, DnD drop targets).
 * Modeled after TaskOrchestrator/tauri-app/src/ui/Sidebar.tsx — Section + FilterItem pattern.
 * Rules: reads theme/density/t from AppContext only; no direct DB access.
 * Accepts contacts array for live counts and group/tag/org derivation.
 * DnD: group, tag, and organization chips become drop targets when the corresponding
 *      onDrop* callback is provided.
 */
import { useState, useMemo } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { Contact, GroupMembership } from '@smart-contacts/shared'
import { deriveLookups, isBirthdayThisMonth } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import {
  Inbox,
  Star,
  Clock,
  Cake,
  Trash2,
  EyeOff,
  Users,
  Tag,
  Briefcase,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Settings,
  X,
  Keyboard,
} from './icons'
import type { ContactFilters } from './filterTypes'
import type { SavedFilter } from './savedFilters'
import { DND_MIME } from './dnd'

interface SidebarProps {
  contacts: Contact[]
  filters: ContactFilters
  setFilter: <K extends keyof ContactFilters>(key: K, value: ContactFilters[K]) => void
  setFilters: (next: ContactFilters) => void
  resetFilters: () => void
  onOpenSettings: () => void
  savedFilters: SavedFilter[]
  onDeleteSavedFilter: (id: string) => void
  /** Panel width in px; driven by parent ResizeHandle state. */
  width: number
  /** Called when a contact row is dropped onto a group chip. */
  onDropContactOnGroup?: (contactId: string, group: GroupMembership) => void
  /** Called when a contact row is dropped onto a tag chip. */
  onDropContactOnTag?: (contactId: string, tagName: string) => void
  /** Called when a contact row is dropped onto an organization chip. */
  onDropContactOnOrganization?: (contactId: string, orgName: string) => void
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
  width,
  onDropContactOnGroup,
  onDropContactOnTag,
  onDropContactOnOrganization,
}: SidebarProps) {
  const { TC, t, density } = useApp()

  // Tracks which chip (group or tag) the user is currently hovering over during a drag.
  const [dropTarget, setDropTarget] = useState<{
    kind: 'group' | 'tag' | 'org'
    key: string
  } | null>(null)

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
      hidden: lookups.hiddenCount,
    }
  }, [contacts, lookups])

  const [open, setOpen] = useState({
    filters: true,
    saved: true,
    groups: true,
    tags: true,
    organizations: true,
    hotkeys: false,
  })
  const toggle = (key: keyof typeof open) => setOpen((o) => ({ ...o, [key]: !o[key] }))

  const SECTION_KEYS: Array<keyof typeof open> = [
    'filters',
    'saved',
    'groups',
    'tags',
    'organizations',
    'hotkeys',
  ]
  const allExpanded = SECTION_KEYS.every((k) => open[k])
  const toggleAll = () => {
    const target = !allExpanded
    setOpen({
      filters: target,
      saved: target,
      groups: target,
      tags: target,
      organizations: target,
      hotkeys: target,
    })
  }

  // Hotkey list — mirrors TaskOrchestrator/tauri-app/src/ui/Sidebar.tsx
  const HOTKEYS: Array<[combo: string, descKey: string]> = [
    ['Ctrl/Cmd+N', 'hotkey.add'],
    ['Ctrl/Cmd+,', 'hotkey.settings'],
    ['j / k', 'hotkey.next'],
    ['e', 'hotkey.edit'],
    ['d', 'hotkey.delete'],
    ['t', 'hotkey.touch'],
    ['/', 'hotkey.search'],
    ['?', 'hotkey.help'],
    ['Esc', 'hotkey.escape'],
  ]

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
      className={`relative flex-shrink-0 border-r p-3 flex flex-col overflow-hidden ${TC.borderClass} ${TC.aside}`}
      style={{ width: `${width}px`, scrollbarWidth: 'thin' }}
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
              active={
                filters.scope === 'all' && !filters.group && !filters.tag && !filters.organization
              }
              onClick={() => {
                setFilter('scope', 'all')
                setFilter('group', null)
                setFilter('tag', null)
                setFilter('organization', undefined)
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
            <FilterItem
              icon={EyeOff}
              label={t('sidebar.hidden')}
              count={counts.hidden}
              active={filters.scope === 'hidden'}
              onClick={() => setFilter('scope', 'hidden')}
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
                {...(onDropContactOnGroup && {
                  onDragOver: (e: React.DragEvent<HTMLButtonElement>) => {
                    if (e.dataTransfer.types.includes(DND_MIME)) {
                      e.preventDefault()
                      setDropTarget({ kind: 'group', key: g.id })
                    }
                  },
                  onDragLeave: () => setDropTarget(null),
                  onDrop: (e: React.DragEvent<HTMLButtonElement>) => {
                    e.preventDefault()
                    const contactId = e.dataTransfer.getData(DND_MIME)
                    if (!contactId) return
                    onDropContactOnGroup(contactId, { id: g.id, name: g.name })
                    setDropTarget(null)
                  },
                })}
                className={`w-full flex items-center gap-2 px-3 rounded-md text-sm transition-colors ${itemPy} ${
                  dropTarget?.kind === 'group' && dropTarget.key === g.id
                    ? 'ring-2 ring-sky-500/60'
                    : ''
                } ${
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
                {...(onDropContactOnTag && {
                  onDragOver: (e: React.DragEvent<HTMLButtonElement>) => {
                    if (e.dataTransfer.types.includes(DND_MIME)) {
                      e.preventDefault()
                      setDropTarget({ kind: 'tag', key: tg.name })
                    }
                  },
                  onDragLeave: () => setDropTarget(null),
                  onDrop: (e: React.DragEvent<HTMLButtonElement>) => {
                    e.preventDefault()
                    const contactId = e.dataTransfer.getData(DND_MIME)
                    if (!contactId) return
                    onDropContactOnTag(contactId, tg.name)
                    setDropTarget(null)
                  },
                })}
                className={`w-full flex items-center gap-2 px-3 rounded-md text-sm transition-colors ${itemPy} ${
                  dropTarget?.kind === 'tag' && dropTarget.key === tg.name
                    ? 'ring-2 ring-sky-500/60'
                    : ''
                } ${
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

        {/* ── Organizations section ── */}
        <Section id="organizations" label={t('sidebar.organizations')} icon={Briefcase}>
          <div className="space-y-0.5">
            {lookups.organizations.length === 0 && (
              <p className={`px-3 text-xs ${TC.textMuted} py-1`}>—</p>
            )}
            {lookups.organizations.map((org) => (
              <button
                key={org.name}
                onClick={() =>
                  filters.organization === org.name
                    ? setFilter('organization', undefined)
                    : setFilter('organization', org.name)
                }
                {...(onDropContactOnOrganization && {
                  onDragOver: (e: React.DragEvent<HTMLButtonElement>) => {
                    if (e.dataTransfer.types.includes(DND_MIME)) {
                      e.preventDefault()
                      setDropTarget({ kind: 'org', key: org.name })
                    }
                  },
                  onDragLeave: () => setDropTarget(null),
                  onDrop: (e: React.DragEvent<HTMLButtonElement>) => {
                    e.preventDefault()
                    const contactId = e.dataTransfer.getData(DND_MIME)
                    if (!contactId) return
                    onDropContactOnOrganization(contactId, org.name)
                    setDropTarget(null)
                  },
                })}
                className={`w-full flex items-center gap-2 px-3 rounded-md text-sm transition-colors ${itemPy} ${
                  dropTarget?.kind === 'org' && dropTarget.key === org.name
                    ? 'ring-2 ring-sky-500/60'
                    : ''
                } ${
                  filters.organization === org.name
                    ? 'bg-sky-600/20 text-sky-300'
                    : `${TC.textMuted} ${TC.hoverBg} hover:text-gray-200`
                }`}
              >
                <span className="flex-1 text-left truncate">{org.name}</span>
                <span className="text-xs opacity-60">{org.count}</span>
                {filters.organization === org.name && <X size={10} className="flex-shrink-0" />}
              </button>
            ))}
          </div>
        </Section>

        {/* ── Hotkeys section (collapsed by default; mirrors TaskOrchestrator) ── */}
        <Section id="hotkeys" label={t('sidebar.hotkeys')} icon={Keyboard}>
          <div className={`space-y-1.5 text-xs ${TC.textMuted}`}>
            {HOTKEYS.map(([combo, key]) => (
              <div key={combo} className="flex items-start gap-2">
                <kbd
                  className={`px-1.5 py-0.5 rounded font-mono text-[10px] whitespace-nowrap flex-shrink-0 ${TC.elevated} ${TC.textSec}`}
                >
                  {combo}
                </kbd>
                <span>{t(key)}</span>
              </div>
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
