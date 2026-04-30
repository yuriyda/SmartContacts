/**
 * @file contactFilter.test.ts
 * Tests for the pure applyContactFilters function extracted from useFilteredContacts.
 * Tests cover hidden-scope logic, default-scope exclusion, trash scope, and search integration.
 * Rules: no React, no DB; pure function tests only.
 */

import { describe, test, expect } from 'vitest'
import type { Contact } from '../types'
import { applyContactFilters } from './contactFilter'
import type { ContactFilters } from './contactFilter'

function makeContact(partial: Partial<Contact>): Contact {
  return {
    id: partial.id ?? 'id',
    createdAt: '',
    updatedAt: '',
    lamportTs: 1,
    deviceId: 'DEV',
    ...partial,
  }
}

const DEFAULT_FILTERS: ContactFilters = {
  scope: 'all',
  group: null,
  tag: null,
  search: '',
}

describe('applyContactFilters – hidden scope', () => {
  test('hidden scope returns only alive+hidden contacts', () => {
    const alive = makeContact({ id: 'alive' })
    const hiddenAlive = makeContact({ id: 'hiddenAlive', hidden: true })
    const hiddenDeleted = makeContact({
      id: 'hiddenDeleted',
      hidden: true,
      deletedAt: '2026-01-01T00:00:00.000Z',
    })

    const result = applyContactFilters([alive, hiddenAlive, hiddenDeleted], {
      ...DEFAULT_FILTERS,
      scope: 'hidden',
    })
    expect(result.map((c) => c.id)).toEqual(['hiddenAlive'])
  })

  test('hidden scope returns empty when no alive+hidden contacts exist', () => {
    const alive = makeContact({ id: 'alive' })
    const result = applyContactFilters([alive], { ...DEFAULT_FILTERS, scope: 'hidden' })
    expect(result).toHaveLength(0)
  })
})

describe('applyContactFilters – all/starred/recent/birthdays scopes exclude hidden', () => {
  test('all scope excludes hidden contacts', () => {
    const alive = makeContact({ id: 'alive' })
    const hiddenAlive = makeContact({ id: 'hiddenAlive', hidden: true })
    const result = applyContactFilters([alive, hiddenAlive], { ...DEFAULT_FILTERS, scope: 'all' })
    expect(result.map((c) => c.id)).toEqual(['alive'])
  })

  test('all scope shows alive non-hidden contacts even if hidden:false explicitly', () => {
    const explicit = makeContact({ id: 'explicit', hidden: false })
    const result = applyContactFilters([explicit], { ...DEFAULT_FILTERS, scope: 'all' })
    expect(result.map((c) => c.id)).toEqual(['explicit'])
  })
})

describe('applyContactFilters – trash scope', () => {
  test('trash scope returns deleted contacts regardless of hidden flag', () => {
    const deletedHidden = makeContact({
      id: 'deletedHidden',
      hidden: true,
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    const deletedNormal = makeContact({
      id: 'deletedNormal',
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    const alive = makeContact({ id: 'alive' })
    const result = applyContactFilters([deletedHidden, deletedNormal, alive], {
      ...DEFAULT_FILTERS,
      scope: 'trash',
    })
    expect(result.map((c) => c.id).sort()).toEqual(['deletedHidden', 'deletedNormal'])
  })
})

describe('applyContactFilters – search integration', () => {
  test('search in non-hidden scope excludes hidden contacts even if they match', () => {
    const alive = makeContact({ id: 'alive', displayName: 'Alice' })
    const hiddenAlice = makeContact({
      id: 'hiddenAlice',
      hidden: true,
      displayName: 'Alice Hidden',
    })
    const result = applyContactFilters([alive, hiddenAlice], {
      ...DEFAULT_FILTERS,
      search: 'alice',
    })
    expect(result.map((c) => c.id)).toEqual(['alive'])
  })

  test('search in hidden scope returns matching hidden alive contacts', () => {
    const hiddenAlice = makeContact({
      id: 'hiddenAlice',
      hidden: true,
      displayName: 'Alice Hidden',
    })
    const hiddenBob = makeContact({ id: 'hiddenBob', hidden: true, displayName: 'Bob Hidden' })
    const result = applyContactFilters([hiddenAlice, hiddenBob], {
      ...DEFAULT_FILTERS,
      scope: 'hidden',
      search: 'alice',
    })
    expect(result.map((c) => c.id)).toEqual(['hiddenAlice'])
  })

  test('search in hidden scope does NOT return deleted hidden contacts matching search', () => {
    const hiddenDeleted = makeContact({
      id: 'hiddenDeleted',
      hidden: true,
      displayName: 'Alice',
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    const result = applyContactFilters([hiddenDeleted], {
      ...DEFAULT_FILTERS,
      scope: 'hidden',
      search: 'alice',
    })
    expect(result).toHaveLength(0)
  })
})

describe('applyContactFilters – group filter with hidden', () => {
  test('hidden scope + group filter returns only hidden contacts in that group', () => {
    const hiddenInGroup = makeContact({
      id: 'hiddenInGroup',
      hidden: true,
      groups: [{ id: 'g1', name: 'Friends' }],
    })
    const hiddenNotInGroup = makeContact({
      id: 'hiddenNotInGroup',
      hidden: true,
      groups: [{ id: 'g2', name: 'Work' }],
    })
    const aliveInGroup = makeContact({
      id: 'aliveInGroup',
      groups: [{ id: 'g1', name: 'Friends' }],
    })
    const result = applyContactFilters([hiddenInGroup, hiddenNotInGroup, aliveInGroup], {
      ...DEFAULT_FILTERS,
      scope: 'hidden',
      group: 'g1',
    })
    expect(result.map((c) => c.id)).toEqual(['hiddenInGroup'])
  })
})
