// lookupGc.ts — Lookup table garbage collector for Smart Contacts.
// Maintains tags_index and groups_index as derived caches over alive contacts.
// Run inside the same transaction as the contact write so consumers always
// see consistent state.
//
// Rules:
//  - Must be called inside an open transaction (tx: DbAdapter), never standalone.
//  - Wipe-and-rebuild strategy: simple, safe, idempotent.
//  - No raw SQL on tags_index / groups_index outside this file.
//  - No `any` types.

import type { DbAdapter } from './adapter'

/**
 * Rebuild tags_index and groups_index from alive contacts (deleted_at IS NULL).
 * Cheap on a few thousand contacts. Idempotent.
 */
export async function runLookupGc(tx: DbAdapter): Promise<void> {
  // Wipe and re-derive. Two-statement approach is simpler and safer than
  // attempting incremental delta-maintenance — the index is small.
  await tx.execute('DELETE FROM tags_index')
  await tx.execute('DELETE FROM groups_index')

  // Pull alive contacts, JSON-decode their tags/groups, accumulate distinct names.
  const rows = await tx.select<{ tags: string | null; groups: string | null }>(
    `SELECT tags, groups FROM contacts WHERE deleted_at IS NULL`,
  )
  const tagSet = new Set<string>()
  const groupMap = new Map<string, string>() // id -> name
  for (const r of rows) {
    if (r.tags) {
      try {
        const arr = JSON.parse(r.tags)
        if (Array.isArray(arr)) for (const t of arr) if (typeof t === 'string') tagSet.add(t)
      } catch {
        /* skip malformed */
      }
    }
    if (r.groups) {
      try {
        const arr = JSON.parse(r.groups)
        if (Array.isArray(arr)) {
          for (const g of arr) {
            if (g && typeof g === 'object' && typeof g.id === 'string') {
              groupMap.set(g.id, typeof g.name === 'string' ? g.name : g.id)
            }
          }
        }
      } catch {
        /* skip malformed */
      }
    }
  }

  for (const name of tagSet) {
    await tx.execute(`INSERT OR IGNORE INTO tags_index (name) VALUES (?)`, [name])
  }
  for (const [id, name] of groupMap) {
    await tx.execute(`INSERT OR REPLACE INTO groups_index (id, name) VALUES (?, ?)`, [id, name])
  }
}
