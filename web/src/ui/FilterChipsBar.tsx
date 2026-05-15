/**
 * @file FilterChipsBar.tsx
 * Removable pills for active filters above the list. Adapted from
 * /workspace/TaskOrchestrator-main/tauri-app/src/TaskOrchestrator.tsx:498-...
 * (visual style + dismiss-X interaction).
 *
 * Behavior:
 *  - Renders one chip per non-default filter dimension (scope, group, tag,
 *    organization, search). Click X clears that single dimension.
 *  - When NO non-trivial filter is set the bar renders nothing (returns null).
 *  - "Reset all" button on the right when any filter is non-trivial.
 *
 * Rules: presentational. Caller owns filter state; this just emits clearFilter
 * events through the supplied setter function.
 */
import { useMemo } from 'react'
import { X } from 'lucide-react'
import type { Contact } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { DEFAULT_FILTERS, type ContactFilters } from './filterTypes'
import { isFilterNonTrivial } from './savedFilters'

interface FilterChipsBarProps {
  filters: ContactFilters
  setFilters: (next: ContactFilters) => void
  resetFilters: () => void
  /** Used to resolve group id → display name in the chip label. */
  contacts: Contact[]
}

export function FilterChipsBar({
  filters,
  setFilters,
  resetFilters,
  contacts,
}: FilterChipsBarProps) {
  const { TC, t } = useApp()

  // Resolve group id → first non-empty display name across all contacts.
  // Falls back to id if no name found (e.g., legacy data with id-only entries).
  const groupNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of contacts) {
      for (const g of c.groups ?? []) {
        if (!map.has(g.id) && g.name && g.name.trim() !== '') {
          map.set(g.id, g.name)
        }
      }
    }
    return map
  }, [contacts])

  // Hide the bar entirely when no non-default filter dimension is active.
  if (!isFilterNonTrivial(filters)) return null

  const chips: { key: string; label: string; onClear: () => void }[] = []

  if (filters.scope !== DEFAULT_FILTERS.scope) {
    chips.push({
      key: 'scope',
      label: t(`sidebar.${filters.scope}`),
      onClear: () => setFilters({ ...filters, scope: DEFAULT_FILTERS.scope }),
    })
  }
  if (filters.group !== null) {
    chips.push({
      key: 'group',
      label: groupNameById.get(filters.group) ?? filters.group,
      onClear: () => setFilters({ ...filters, group: null }),
    })
  }
  if (filters.tag !== null) {
    chips.push({
      key: 'tag',
      label: `#${filters.tag}`,
      onClear: () => setFilters({ ...filters, tag: null }),
    })
  }
  if (filters.organization !== undefined) {
    chips.push({
      key: 'organization',
      label: filters.organization,
      onClear: () => {
        // Drop the optional `organization` key entirely (exactOptionalPropertyTypes).
        const next: ContactFilters = {
          scope: filters.scope,
          group: filters.group,
          tag: filters.tag,
          search: filters.search,
        }
        setFilters(next)
      },
    })
  }
  if (filters.search) {
    chips.push({
      key: 'search',
      label: `“${filters.search}”`,
      onClear: () => setFilters({ ...filters, search: '' }),
    })
  }
  if (filters.hasPhoto === true) {
    chips.push({
      key: 'hasPhoto',
      label: t('filter.with_photo') || 'With photo',
      onClear: () => {
        // Drop the optional `hasPhoto` key entirely so the filter
        // returns to its default-shape (exactOptionalPropertyTypes).
        const next: ContactFilters = {
          scope: filters.scope,
          group: filters.group,
          tag: filters.tag,
          search: filters.search,
        }
        if (filters.organization !== undefined) next.organization = filters.organization
        setFilters(next)
      },
    })
  }

  return (
    <div className={`flex items-center gap-1.5 flex-wrap px-3 py-2 border-b ${TC.borderClass}`}>
      <span className={`text-xs mr-1 ${TC.textMuted}`}>{t('filter.label')}</span>
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 bg-sky-600/20 text-sky-300 px-2 py-0.5 rounded text-xs"
        >
          {c.label}
          <button
            type="button"
            onClick={c.onClear}
            className="hover:text-white"
            aria-label={t('filter.clear')}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={resetFilters}
        className={`ml-auto text-xs px-2 py-0.5 rounded ${TC.textMuted} hover:${TC.text}`}
      >
        {t('filter.reset_all')}
      </button>
    </div>
  )
}
