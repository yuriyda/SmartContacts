// Tests for lookup.ts — group/tag frequency aggregation.
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
    expect(deriveLookups([])).toEqual({ groups: [], tags: [] })
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
})
