// @vitest-environment node
// Tests for contactActions.ts — bumpLamport, mirrorInternalRelation,
// validateCustomFieldKeys, computeDisplayName.
//
// Uses @vitest-environment node because wa-sqlite WASM cannot run under jsdom.
// fake-indexeddb/auto is imported explicitly to provide IndexedDB in Node.js.

import 'fake-indexeddb/auto'
import { describe, test, expect } from 'vitest'
import type { Contact } from '../types'
import { openWaSqliteAdapter } from '../db/wa-sqlite-backend'
import { applyMigrations } from '../db/migrations'
import {
  bumpLamport,
  mirrorInternalRelation,
  validateCustomFieldKeys,
  computeDisplayName,
  countChangedFields,
} from './contactActions'

// ---------------------------------------------------------------------------
// bumpLamport
// ---------------------------------------------------------------------------

describe('bumpLamport', () => {
  test('increments per device and persists', async () => {
    const db = await openWaSqliteAdapter('contact-actions-test-1')
    await applyMigrations(db)
    await db.execute(`INSERT INTO vector_clock (device_id, counter) VALUES ('DEV1', 0)`)
    expect(await bumpLamport(db, 'DEV1')).toBe(1)
    expect(await bumpLamport(db, 'DEV1')).toBe(2)
    await db.close()
  }, 30_000)

  test('seeds counter for an unknown device', async () => {
    const db = await openWaSqliteAdapter('contact-actions-test-2')
    await applyMigrations(db)
    expect(await bumpLamport(db, 'DEVNEW')).toBe(1)
    await db.close()
  }, 30_000)
})

// ---------------------------------------------------------------------------
// mirrorInternalRelation
// ---------------------------------------------------------------------------

describe('mirrorInternalRelation', () => {
  test('queues B->A when only A->B exists', () => {
    const contacts: Contact[] = [
      {
        id: 'A',
        createdAt: '',
        updatedAt: '',
        lamportTs: 1,
        deviceId: 'D',
        relationsInternal: [{ contactId: 'B', type: 'colleague' }],
      },
      {
        id: 'B',
        createdAt: '',
        updatedAt: '',
        lamportTs: 1,
        deviceId: 'D',
        relationsInternal: [],
      },
    ]
    const out = mirrorInternalRelation(contacts, 'A', 'B', 'colleague')
    expect(out.added).toEqual([{ contactId: 'B', rel: { contactId: 'A', type: 'colleague' } }])
  })

  test('skips when mirror already exists', () => {
    const contacts: Contact[] = [
      {
        id: 'A',
        createdAt: '',
        updatedAt: '',
        lamportTs: 1,
        deviceId: 'D',
        relationsInternal: [{ contactId: 'B' }],
      },
      {
        id: 'B',
        createdAt: '',
        updatedAt: '',
        lamportTs: 1,
        deviceId: 'D',
        relationsInternal: [{ contactId: 'A' }],
      },
    ]
    const out = mirrorInternalRelation(contacts, 'A', 'B')
    expect(out.added).toEqual([])
  })

  test('returns empty when target contact does not exist', () => {
    const contacts: Contact[] = [
      {
        id: 'A',
        createdAt: '',
        updatedAt: '',
        lamportTs: 1,
        deviceId: 'D',
        relationsInternal: [],
      },
    ]
    const out = mirrorInternalRelation(contacts, 'A', 'MISSING')
    expect(out.added).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// computeDisplayName
// ---------------------------------------------------------------------------

describe('computeDisplayName', () => {
  test('fallback chain', () => {
    expect(computeDisplayName({ displayName: 'Foo' })).toBe('Foo')
    expect(computeDisplayName({ givenName: 'Иван', familyName: 'Иванов' })).toBe('Иван Иванов')
    expect(computeDisplayName({ givenName: 'Иван' })).toBe('Иван')
    expect(computeDisplayName({ nickname: 'Ваня' })).toBe('Ваня')
    expect(computeDisplayName({}, 'ru')).toBe('(без имени)')
    expect(computeDisplayName({}, 'en')).toBe('(no name)')
  })

  test('default locale (undefined) falls back to en label', () => {
    expect(computeDisplayName({})).toBe('(no name)')
  })
})

// ---------------------------------------------------------------------------
// validateCustomFieldKeys
// ---------------------------------------------------------------------------

describe('validateCustomFieldKeys', () => {
  test('returns dangling keys', () => {
    const c = { customFields: { foo: 1, bar: '2' } } as unknown as Contact
    expect(validateCustomFieldKeys(c, new Set(['foo']))).toEqual(['bar'])
  })

  test('returns empty when all keys are known', () => {
    const c = { customFields: { foo: 1 } } as unknown as Contact
    expect(validateCustomFieldKeys(c, new Set(['foo']))).toEqual([])
  })

  test('returns empty when contact has no customFields', () => {
    const c = {} as Contact
    expect(validateCustomFieldKeys(c, new Set(['foo']))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// countChangedFields
// ---------------------------------------------------------------------------

/** Minimal valid Contact fixture for countChangedFields tests. */
function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'C1',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    lamportTs: 1,
    deviceId: 'DEV',
    ...overrides,
  }
}

describe('countChangedFields', () => {
  test('same reference returns 0', () => {
    const c = makeContact()
    expect(countChangedFields(c, c)).toBe(0)
  })

  test('shallow clone with no value changes returns 0', () => {
    const c = makeContact({ givenName: 'Alice' })
    expect(countChangedFields(c, { ...c })).toBe(0)
  })

  test('changing givenName counts as 1', () => {
    const original = makeContact({ givenName: 'Alice' })
    const edited = { ...original, givenName: 'Bob' }
    expect(countChangedFields(original, edited)).toBe(1)
  })

  test('changing givenName AND priority counts as 2', () => {
    const original = makeContact({ givenName: 'Alice', priority: 3 })
    const edited = { ...original, givenName: 'Bob', priority: 1 }
    expect(countChangedFields(original, edited)).toBe(2)
  })

  test('changing tags array content counts as 1', () => {
    const original = makeContact({ tags: ['work'] })
    const edited = { ...original, tags: ['home'] }
    expect(countChangedFields(original, edited)).toBe(1)
  })

  test('identical tags array (different reference) counts as 0', () => {
    const original = makeContact({ tags: ['work', 'vip'] })
    const edited = { ...original, tags: ['work', 'vip'] }
    expect(countChangedFields(original, edited)).toBe(0)
  })

  test('changing phones array counts as 1', () => {
    const original = makeContact({ phones: [{ value: '+1', type: 'mobile', primary: true }] })
    const edited = { ...original, phones: [{ value: '+2', type: 'mobile', primary: true }] }
    expect(countChangedFields(original, edited)).toBe(1)
  })

  test('bumping only updatedAt and lamportTs counts as 0 (skip list)', () => {
    const original = makeContact()
    const edited = { ...original, updatedAt: '2025-01-01', lamportTs: 99 }
    expect(countChangedFields(original, edited)).toBe(0)
  })

  test('adding a field absent in original counts as 1', () => {
    const original = makeContact()
    const edited = { ...original, givenName: 'Alice' }
    expect(countChangedFields(original, edited)).toBe(1)
  })

  test('removing a field present in original counts as 1', () => {
    const original = makeContact({ givenName: 'Alice' })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { givenName: _removed, ...rest } = original
    const edited = rest as Contact
    expect(countChangedFields(original, edited)).toBe(1)
  })
})
