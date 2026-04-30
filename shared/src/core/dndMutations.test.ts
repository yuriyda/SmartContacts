/**
 * @file dndMutations.test.ts
 * Unit tests for pure DnD mutation helpers: addContactToGroup, addContactToTag,
 * addContactToOrganization.
 * Run under vitest (shared package). No DOM required.
 */

import { describe, test, expect } from 'vitest'
import { addContactToGroup, addContactToTag, addContactToOrganization } from './dndMutations'
import type { Contact } from '../types'

// Minimal Contact factory — only required sync fields, rest undefined.
function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c1',
    displayName: 'Test Contact',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    lamportTs: 0,
    deviceId: 'dev1',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// addContactToGroup
// ---------------------------------------------------------------------------

describe('addContactToGroup', () => {
  test('appends group when contact has no groups', () => {
    const c = makeContact()
    const result = addContactToGroup(c, { id: 'g_friends', name: 'Friends' })
    expect(result.groups).toEqual([{ id: 'g_friends', name: 'Friends' }])
  })

  test('appends group when contact has other groups', () => {
    const c = makeContact({ groups: [{ id: 'g_work', name: 'Work' }] })
    const result = addContactToGroup(c, { id: 'g_friends', name: 'Friends' })
    expect(result.groups).toHaveLength(2)
    expect(result.groups).toContainEqual({ id: 'g_friends', name: 'Friends' })
    expect(result.groups).toContainEqual({ id: 'g_work', name: 'Work' })
  })

  test('idempotent: returns same reference when already a member', () => {
    const c = makeContact({ groups: [{ id: 'g_friends', name: 'Friends' }] })
    const result = addContactToGroup(c, { id: 'g_friends', name: 'Friends' })
    expect(result).toBe(c)
  })

  test('id match is case-sensitive', () => {
    const c = makeContact({ groups: [{ id: 'g_friends', name: 'Friends' }] })
    const result = addContactToGroup(c, { id: 'g_Friends', name: 'Friends' })
    // Different case = different id → should append
    expect(result.groups).toHaveLength(2)
  })

  test('does not touch other contact fields', () => {
    const c = makeContact({ tags: ['vip'], priority: 1 })
    const result = addContactToGroup(c, { id: 'g_work', name: 'Work' })
    expect(result.tags).toEqual(['vip'])
    expect(result.priority).toBe(1)
    expect(result.id).toBe('c1')
  })
})

// ---------------------------------------------------------------------------
// addContactToTag
// ---------------------------------------------------------------------------

describe('addContactToTag', () => {
  test('appends tag when contact has no tags', () => {
    const c = makeContact()
    const result = addContactToTag(c, 'vip')
    expect(result.tags).toEqual(['vip'])
  })

  test('appends tag when contact has other tags', () => {
    const c = makeContact({ tags: ['client'] })
    const result = addContactToTag(c, 'vip')
    expect(result.tags).toHaveLength(2)
    expect(result.tags).toContain('vip')
    expect(result.tags).toContain('client')
  })

  test('idempotent: returns same reference when tag already present', () => {
    const c = makeContact({ tags: ['vip', 'client'] })
    const result = addContactToTag(c, 'vip')
    expect(result).toBe(c)
  })

  test('tag match is case-sensitive', () => {
    const c = makeContact({ tags: ['vip'] })
    const result = addContactToTag(c, 'VIP')
    // Different case = different tag → should append
    expect(result.tags).toHaveLength(2)
  })

  test('does not touch other contact fields', () => {
    const c = makeContact({ groups: [{ id: 'g_work', name: 'Work' }], priority: 2 })
    const result = addContactToTag(c, 'vip')
    expect(result.groups).toEqual([{ id: 'g_work', name: 'Work' }])
    expect(result.priority).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// addContactToOrganization
// ---------------------------------------------------------------------------

describe('addContactToOrganization', () => {
  test('appends organization with current=false when contact has no orgs', () => {
    const c = makeContact()
    const result = addContactToOrganization(c, 'Acme')
    expect(result.organizations).toEqual([{ name: 'Acme', current: false }])
  })

  test('appends organization when contact has orgs with different names', () => {
    const c = makeContact({ organizations: [{ name: 'OtherCo', current: true }] })
    const result = addContactToOrganization(c, 'Acme')
    expect(result.organizations).toHaveLength(2)
    expect(result.organizations).toContainEqual({ name: 'Acme', current: false })
    expect(result.organizations).toContainEqual({ name: 'OtherCo', current: true })
  })

  test('idempotent: returns same reference when org name already present (current=false)', () => {
    const c = makeContact({ organizations: [{ name: 'Acme', current: false }] })
    const result = addContactToOrganization(c, 'Acme')
    expect(result).toBe(c)
  })

  test('idempotent: no-op when org name already present even with current=true', () => {
    // User is just classifying — if already there with any current value, skip
    const c = makeContact({
      organizations: [{ name: 'Acme', current: true, title: 'CEO' }],
    })
    const result = addContactToOrganization(c, 'Acme')
    expect(result).toBe(c)
    // Existing entry must be preserved as-is
    expect(result.organizations![0]).toEqual({ name: 'Acme', current: true, title: 'CEO' })
  })

  test('org name match is case-sensitive', () => {
    const c = makeContact({ organizations: [{ name: 'Acme', current: false }] })
    const result = addContactToOrganization(c, 'acme')
    // Different case = different org → should append
    expect(result.organizations).toHaveLength(2)
  })

  test('does not touch other contact fields', () => {
    const c = makeContact({ tags: ['vip'], priority: 1 })
    const result = addContactToOrganization(c, 'Acme')
    expect(result.tags).toEqual(['vip'])
    expect(result.priority).toBe(1)
  })
})
