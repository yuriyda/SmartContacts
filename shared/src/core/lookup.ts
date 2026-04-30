// Lookup aggregation helpers for Smart Contacts.
// Pure functions — no DB access, no side effects.
// Computes group / tag / organization frequency counts from an in-memory contact list.
// Only alive contacts (deletedAt is null or undefined) contribute to counts.
// Organizations are sorted by mostRecentUpdate DESC, then name ASC, capped at 50.

import type { Contact } from '../types'

export interface LookupCounts {
  groups: Array<{ id: string; name: string; count: number }>
  tags: Array<{ name: string; count: number }>
  organizations: Array<{ name: string; count: number; mostRecentUpdate: string }>
}

/**
 * Aggregate group/tag/organization frequencies across alive contacts (deletedAt is null/undefined).
 *
 * Groups: sort desc by count, then name asc.
 * Tags: sort desc by count, then name asc.
 * Organizations: sort desc by mostRecentUpdate (max updatedAt of any mentioning contact),
 *   tiebreak name asc. Capped at 50. Same name on multiple org entries of one contact counts once.
 *
 * Group name resolution: prefer first non-empty `name` seen for a given `id`;
 * if every occurrence has only an `id`, fallback name = id.
 */
export function deriveLookups(contacts: Contact[]): LookupCounts {
  const groupCount = new Map<string, number>()
  // Stores the resolved name for each group id (first non-empty name wins)
  const groupName = new Map<string, string>()
  const tagCount = new Map<string, number>()
  // Organization accumulator: name → { count, mostRecentUpdate }
  const orgMap = new Map<string, { count: number; mostRecentUpdate: string }>()

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

    // Accumulate organizations — deduplicate same name within one contact via a Set.
    const seenNamesThisContact = new Set<string>()
    for (const org of c.organizations ?? []) {
      const name = org.name
      if (!name || name.trim() === '') continue
      if (seenNamesThisContact.has(name)) continue
      seenNamesThisContact.add(name)

      const contactTs = c.updatedAt ?? ''
      const existing = orgMap.get(name)
      if (existing) {
        existing.count += 1
        if (contactTs > existing.mostRecentUpdate) {
          existing.mostRecentUpdate = contactTs
        }
      } else {
        orgMap.set(name, { count: 1, mostRecentUpdate: contactTs })
      }
    }
  }

  const groups = Array.from(groupCount.entries())
    .map(([id, count]) => ({ id, name: groupName.get(id) ?? id, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const tags = Array.from(tagCount.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  const organizations = Array.from(orgMap.entries())
    .map(([name, { count, mostRecentUpdate }]) => ({ name, count, mostRecentUpdate }))
    .sort(
      (a, b) =>
        b.mostRecentUpdate.localeCompare(a.mostRecentUpdate) || a.name.localeCompare(b.name),
    )
    .slice(0, 50)

  return { groups, tags, organizations }
}
