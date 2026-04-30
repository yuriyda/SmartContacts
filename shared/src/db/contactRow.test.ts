// Round-trip tests for contactToRow / rowToContact.
// Covers: fully-populated, minimal, empty arrays/objects, null-vs-undefined semantics,
// and missing required column error path.

import { describe, expect, test } from 'vitest'
import { contactToRow, rowToContact } from './contactRow'
import type { Contact } from '../types'

const fully: Contact = {
  id: '01HX0000000000000000000001',
  givenName: 'Иван',
  familyName: 'Иванов',
  middleName: 'С',
  honorificPrefix: 'Mr',
  honorificSuffix: 'Jr',
  phoneticGiven: 'Ivan',
  phoneticFamily: 'Ivanov',
  displayName: 'Иван Иванов',
  nickname: 'Ваня',
  phones: [{ value: '+7 999 1', type: 'mobile', primary: true }],
  emails: [{ value: 'ivan@example.com', type: 'home', primary: true }],
  addresses: [{ street: 'X', city: 'Y', country: 'RU', type: 'home' }],
  events: [{ date: '1985-03-15', type: 'birthday' }],
  organizations: [{ name: 'Acme', title: 'CTO', current: true }],
  urls: [{ value: 'https://x', type: 'work' }],
  imClients: [{ protocol: 'telegram', handle: '@ivan' }],
  relationsExternal: [{ person: 'Anna', type: 'spouse' }],
  groups: [{ id: 'g1', name: 'Work' }],
  notesMd: '## Hi',
  userDefined: { foo: 'bar' },
  locale: 'ru',
  gender: 'male',
  occupation: 'eng',
  tags: ['dev', 'friend'],
  relationsInternal: [{ contactId: '01HX2', type: 'colleague' }],
  customFields: { coffee: 'espresso', count: 3, paid: true, removed: null },
  lastContactedAt: '2026-04-20T10:00:00.000Z',
  preferredChannel: 'telegram',
  priority: 2,
  socialDetected: [{ platform: 'telegram', handle: '@ivan' }],
  reminders: [{ id: 'r1', date: '2026-05-01', text: 'birthday', done: false }],
  googleResourceName: 'people/c1',
  googleEtag: 'abc',
  googleLastSyncedAt: '2026-04-29T00:00:00.000Z',
  avatarHash: 'h1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-04-29T00:00:00.000Z',
  deletedAt: null,
  lamportTs: 42,
  deviceId: 'DEV1',
}

const minimal: Contact = {
  id: '01HX0000000000000000000002',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lamportTs: 1,
  deviceId: 'DEV1',
}

describe('contactRow round-trip', () => {
  test('fully populated contact round-trips deep-equal', () => {
    expect(rowToContact(contactToRow(fully))).toEqual(fully)
  })
  test('minimal contact round-trips deep-equal', () => {
    expect(rowToContact(contactToRow(minimal))).toEqual(minimal)
  })
  test('empty arrays round-trip as []', () => {
    const c: Contact = { ...minimal, tags: [], phones: [] }
    const r = contactToRow(c)
    expect(r['tags']).toBe('[]')
    expect(r['phones']).toBe('[]')
    const back = rowToContact(r)
    expect(back.tags).toEqual([])
    expect(back.phones).toEqual([])
  })
  test('empty userDefined object round-trips as {}', () => {
    const c: Contact = { ...minimal, userDefined: {} }
    const r = contactToRow(c)
    expect(r['user_defined']).toBe('{}')
    expect(rowToContact(r).userDefined).toEqual({})
  })
  test('null deletedAt distinct from missing', () => {
    const c: Contact = { ...minimal, deletedAt: null }
    expect(rowToContact(contactToRow(c)).deletedAt).toBe(null)
  })
  test('throws on missing required column', () => {
    expect(() => rowToContact({} as Record<string, unknown>)).toThrow(/missing required/i)
  })

  // P7.T1: protected and hidden boolean flags
  test('protected:true round-trips as true', () => {
    const c: Contact = { ...minimal, protected: true }
    const result = rowToContact(contactToRow(c))
    expect(result.protected).toBe(true)
  })
  test('hidden:true and protected:true both round-trip as true', () => {
    const c: Contact = { ...minimal, hidden: true, protected: true }
    const result = rowToContact(contactToRow(c))
    expect(result.hidden).toBe(true)
    expect(result.protected).toBe(true)
  })
  test('no flags set: protected and hidden are absent from result', () => {
    const result = rowToContact(contactToRow(minimal))
    expect(result.protected).toBeUndefined()
    expect(result.hidden).toBeUndefined()
  })
})
