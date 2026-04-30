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
