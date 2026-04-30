// Tests for lookup.ts — group/tag/organization frequency aggregation.
// Run under default jsdom environment (no wa-sqlite, no IndexedDB needed).

import { describe, test, expect } from 'vitest'
import type { Contact } from '../types'
import { deriveLookups } from './lookup'

function makeContact(partial: Partial<Contact>): Contact {
  return {
    id: 'id',
    createdAt: '',
    updatedAt: '',
    lamportTs: 1,
    deviceId: 'DEV',
    ...partial,
  }
}

describe('deriveLookups', () => {
  test('empty list → empty result', () => {
    expect(deriveLookups([])).toEqual({ groups: [], tags: [], organizations: [] })
  })

  test('one contact with two tags and one group → counts both = 1', () => {
    const c = makeContact({
      groups: [{ id: 'g1', name: 'Friends' }],
      tags: ['vip', 'local'],
    })
    const result = deriveLookups([c])
    expect(result.groups).toEqual([{ id: 'g1', name: 'Friends', count: 1 }])
    expect(result.tags).toContainEqual({ name: 'vip', count: 1 })
    expect(result.tags).toContainEqual({ name: 'local', count: 1 })
  })

  test('two contacts sharing a tag → tag count = 2', () => {
    const c1 = makeContact({ id: 'c1', tags: ['vip'] })
    const c2 = makeContact({ id: 'c2', tags: ['vip'] })
    const result = deriveLookups([c1, c2])
    expect(result.tags).toEqual([{ name: 'vip', count: 2 }])
  })

  test('contact with deletedAt set is ignored', () => {
    const alive = makeContact({ id: 'alive', tags: ['keep'], groups: [{ id: 'g1' }] })
    const dead = makeContact({
      id: 'dead',
      tags: ['keep', 'gone'],
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    const result = deriveLookups([alive, dead])
    expect(result.tags).toEqual([{ name: 'keep', count: 1 }])
    expect(result.groups).toEqual([{ id: 'g1', name: 'g1', count: 1 }])
  })

  test('group name fallback to id when name is absent', () => {
    const c = makeContact({ groups: [{ id: 'g-no-name' }] })
    const result = deriveLookups([c])
    expect(result.groups[0]).toEqual({ id: 'g-no-name', name: 'g-no-name', count: 1 })
  })

  test('sort groups desc by count, then asc by name', () => {
    const c1 = makeContact({
      id: 'c1',
      groups: [
        { id: 'gA', name: 'Alpha' },
        { id: 'gB', name: 'Beta' },
      ],
    })
    const c2 = makeContact({ id: 'c2', groups: [{ id: 'gA', name: 'Alpha' }] })
    const result = deriveLookups([c1, c2])
    expect(result.groups[0]?.id).toBe('gA')
    expect(result.groups[1]?.id).toBe('gB')
  })

  // ── Organization tests ──────────────────────────────────────────────────────

  test('empty list → empty organizations', () => {
    expect(deriveLookups([]).organizations).toEqual([])
  })

  test('three contacts with mixed organizations → sorted by recency desc', () => {
    const c1 = makeContact({
      id: 'c1',
      updatedAt: '2026-01-10T00:00:00.000Z',
      organizations: [{ name: 'Acme' }],
    })
    const c2 = makeContact({
      id: 'c2',
      updatedAt: '2026-03-01T00:00:00.000Z',
      organizations: [{ name: 'Globex' }, { name: 'Acme' }],
    })
    const c3 = makeContact({
      id: 'c3',
      updatedAt: '2026-02-15T00:00:00.000Z',
      organizations: [{ name: 'Initech' }],
    })
    const { organizations } = deriveLookups([c1, c2, c3])
    // Globex only in c2 (2026-03-01), Initech only in c3 (2026-02-15), Acme in c1+c2 (max 2026-03-01)
    // But Globex and Acme share the same mostRecentUpdate (2026-03-01) → tiebreak alpha: Acme < Globex
    expect(organizations.map((o) => o.name)).toEqual(['Acme', 'Globex', 'Initech'])
    expect(organizations.find((o) => o.name === 'Acme')?.count).toBe(2)
    expect(organizations.find((o) => o.name === 'Globex')?.count).toBe(1)
    expect(organizations.find((o) => o.name === 'Initech')?.count).toBe(1)
  })

  test('organizations cap of 50 honoured', () => {
    // Build 60 contacts each with a unique org name
    const contacts = Array.from({ length: 60 }, (_, i) =>
      makeContact({
        id: `c${i}`,
        updatedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`.replace(
          /01-(\d{2})/,
          (_, d) => `${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${d}`,
        ),
        organizations: [{ name: `Org${i}` }],
      }),
    )
    const { organizations } = deriveLookups(contacts)
    expect(organizations.length).toBe(50)
  })

  test('soft-deleted contacts do NOT contribute to organizations', () => {
    const alive = makeContact({
      id: 'alive',
      updatedAt: '2026-01-01T00:00:00.000Z',
      organizations: [{ name: 'VisibleOrg' }],
    })
    const dead = makeContact({
      id: 'dead',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: '2026-01-02T00:00:00.000Z',
      organizations: [{ name: 'HiddenOrg' }],
    })
    const { organizations } = deriveLookups([alive, dead])
    expect(organizations.map((o) => o.name)).toEqual(['VisibleOrg'])
  })

  test('same org name twice on one contact counts as 1', () => {
    const c = makeContact({
      id: 'c1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      organizations: [{ name: 'Dupe' }, { name: 'Dupe', title: 'CTO' }],
    })
    const { organizations } = deriveLookups([c])
    expect(organizations).toHaveLength(1)
    expect(organizations[0]?.count).toBe(1)
  })

  test('two orgs with identical mostRecentUpdate sort alphabetically', () => {
    const ts = '2026-04-01T00:00:00.000Z'
    const c = makeContact({
      id: 'c1',
      updatedAt: ts,
      organizations: [{ name: 'Zebra' }, { name: 'Apple' }],
    })
    const { organizations } = deriveLookups([c])
    expect(organizations[0]?.name).toBe('Apple')
    expect(organizations[1]?.name).toBe('Zebra')
  })

  test('empty or missing org names are skipped', () => {
    const c = makeContact({
      id: 'c1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      organizations: [{ name: '' }, { name: '   ' }, { title: 'CEO' }, { name: 'Valid' }],
    })
    const { organizations } = deriveLookups([c])
    expect(organizations).toHaveLength(1)
    expect(organizations[0]?.name).toBe('Valid')
  })
})
