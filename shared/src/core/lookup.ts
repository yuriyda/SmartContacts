// Lookup aggregation helpers for Smart Contacts.
// Pure functions — no DB access, no side effects.
// Computes group / tag frequency counts from an in-memory contact list.
// Only alive contacts (deletedAt is null or undefined) contribute to counts.

import type { Contact } from '../types'

export interface LookupCounts {
  groups: Array<{ id: string; name: string; count: number }>
  tags: Array<{ name: string; count: number }>
}

/**
 * Aggregate group/tag frequencies across alive contacts (deletedAt is null/undefined).
 * Sort desc by count, then name asc.
 *
 * Group name resolution: prefer first non-empty `name` seen for a given `id`;
 * if every occurrence has only an `id`, fallback name = id.
 */
export function deriveLookups(contacts: Contact[]): LookupCounts {
  const groupCount = new Map<string, number>()
  // Stores the resolved name for each group id (first non-empty name wins)
  const groupName = new Map<string, string>()
  const tagCount = new Map<string, number>()

  for (const c of contacts) {
    // Skip soft-deleted contacts
    if (c.deletedAt != null) continue

    for (const g of c.groups ?? []) {
      const id = g.id
      groupCount.set(id, (groupCount.get(id) ?? 0) + 1)
      // Persist first non-empty name seen
      if (!groupName.has(id) || groupName.get(id) === id) {
        const resolved = g.name && g.name.trim() !== '' ? g.name : id
        groupName.set(id, resolved)
      }
    }

    for (const tag of c.tags ?? []) {
      tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
    }
  }

  const groups = Array.from(groupCount.entries())
    .map(([id, count]) => ({ id, name: groupName.get(id) ?? id, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const tags = Array.from(tagCount.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return { groups, tags }
}
