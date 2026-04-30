/**
 * @file contactFilter.ts
 * Pure, framework-agnostic contact filter pipeline extracted from useFilteredContacts.
 * Consumed by the React hook (useFilteredContacts) and unit tests in shared.
 *
 * Rules:
 * - No React imports, no side effects, no DB access.
 * - Hidden logic: scope='hidden' shows ONLY alive+hidden; all other non-trash scopes
 *   exclude hidden contacts entirely; trash scope ignores the hidden flag.
 * - Search respects the same hidden rules: when scope='hidden' search scans
 *   alive+hidden contacts; otherwise search scans alive+non-hidden contacts.
 */

import type { Contact } from '../types'
import { isBirthdayThisMonth } from './date'

/** Scope + refinement filter state — mirrors web/src/ui/filterTypes.ContactFilters. */
export interface ContactFilters {
  scope: 'all' | 'starred' | 'recent' | 'birthdays' | 'trash' | 'hidden'
  group: string | null
  tag: string | null
  organization?: string
  search: string
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Apply ContactFilters to a flat contact list and return the matching subset.
 *
 * Pool construction order (hidden-aware):
 *  1. Split on scope: trash → deleted; all others → alive.
 *  2. Apply hidden rules inside the alive branch.
 *  3. Apply scope-specific sub-filters (starred/recent/birthdays/hidden).
 *  4. Apply group/tag/org cross-filters.
 *  5. Apply search against the already-filtered pool.
 */
export function applyContactFilters(contacts: Contact[], filters: ContactFilters): Contact[] {
  let pool: Contact[]

  if (filters.scope === 'trash') {
    // Trash shows deleted contacts regardless of hidden flag.
    pool = contacts.filter((c) => !!c.deletedAt)
  } else {
    // All other scopes operate on alive contacts.
    pool = contacts.filter((c) => !c.deletedAt)

    if (filters.scope === 'hidden') {
      // Hidden scope: show ONLY hidden-alive contacts.
      pool = pool.filter((c) => c.hidden === true)
    } else {
      // All other non-trash scopes: exclude hidden contacts.
      pool = pool.filter((c) => c.hidden !== true)

      if (filters.scope === 'starred') {
        pool = pool.filter((c) => (c.priority ?? 5) <= 2)
      } else if (filters.scope === 'recent') {
        const cutoff = Date.now() - SEVEN_DAYS_MS
        pool = pool.filter(
          (c) => c.lastContactedAt && new Date(c.lastContactedAt).getTime() >= cutoff,
        )
      } else if (filters.scope === 'birthdays') {
        pool = pool.filter((c) =>
          (c.events ?? []).some((e) => e.type === 'birthday' && isBirthdayThisMonth(e.date)),
        )
      }
      // scope === 'all': no additional sub-filter needed.
    }
  }

  // Group / tag / org narrow the pool further (intersection).
  if (filters.group) {
    pool = pool.filter((c) => (c.groups ?? []).some((g) => g.id === filters.group))
  }
  if (filters.tag) {
    pool = pool.filter((c) => (c.tags ?? []).includes(filters.tag!))
  }
  if (filters.organization) {
    pool = pool.filter((c) => (c.organizations ?? []).some((o) => o.name === filters.organization))
  }

  // Search is applied last against the already scope/group/tag-filtered pool.
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase()
    pool = pool.filter((c) => {
      const fields = [c.displayName, c.givenName, c.familyName, c.nickname]
        .filter((s): s is string => !!s)
        .join(' ')
        .toLowerCase()
      return fields.includes(q)
    })
  }

  return pool
}
