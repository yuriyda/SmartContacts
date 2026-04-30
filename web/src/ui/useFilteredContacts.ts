/**
 * @file useFilteredContacts.ts
 * Pure React hook that applies ContactFilters to a contact list and returns the visible subset.
 * Rules: no UI imports; only React, shared types, and filterTypes.
 * Search overrides all other filters (searches alive contacts only).
 * Scope/group/tag are applied in conjunction.
 */
import { useMemo } from 'react'
import type { Contact } from '@smart-contacts/shared'
import { isBirthdayThisMonth } from '@smart-contacts/shared'
import type { ContactFilters } from './filterTypes'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function useFilteredContacts(contacts: Contact[], filters: ContactFilters): Contact[] {
  return useMemo(() => {
    // Search beats everything else — scans alive contacts only.
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase()
      return contacts
        .filter((c) => !c.deletedAt)
        .filter((c) => {
          const fields = [c.displayName, c.givenName, c.familyName, c.nickname]
            .filter((s): s is string => !!s)
            .join(' ')
            .toLowerCase()
          return fields.includes(q)
        })
    }

    let pool = contacts

    // Scope determines alive vs. deleted branch.
    if (filters.scope === 'trash') {
      pool = pool.filter((c) => !!c.deletedAt)
    } else {
      pool = pool.filter((c) => !c.deletedAt)

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
    }

    // Group and tag are additional (intersect) filters.
    if (filters.group) {
      pool = pool.filter((c) => (c.groups ?? []).some((g) => g.id === filters.group))
    }
    if (filters.tag) {
      pool = pool.filter((c) => (c.tags ?? []).includes(filters.tag!))
    }

    return pool
  }, [contacts, filters])
}
