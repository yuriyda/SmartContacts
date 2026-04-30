// Tests for the demo data generator (shared/src/core/demo.ts).
// Validates: bundle size, referential integrity of relationsInternal, field-density
// targets, customField def key validity, group count, and DB load idempotency.
// Do NOT mock random — rndCrockford is deterministic per-call structure (not value).
// @vitest-environment node

import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from '../db/wa-sqlite-backend'
import { applyMigrations } from '../db/migrations'
import { initDevice, getDeviceId } from '../db/init'
import { buildDemoContacts, loadDemo, getDemoSeed } from './demo'

describe('buildDemoContacts (en)', () => {
  const bundle = buildDemoContacts('en', 'TEST_DEV')

  test('returns exactly 50 contacts', () => {
    expect(bundle.contacts.length).toBe(50)
  })

  test('all relationsInternal contactIds resolve to other contacts in the same array', () => {
    const allIds = new Set(bundle.contacts.map((c) => c.id))
    for (const c of bundle.contacts) {
      for (const r of c.relationsInternal ?? []) {
        expect(allIds.has(r.contactId)).toBe(true)
      }
    }
  })

  test('every contact has at least one group', () => {
    for (const c of bundle.contacts) {
      expect(c.groups?.length ?? 0).toBeGreaterThan(0)
    }
  })

  test('every contact has at least one tag', () => {
    for (const c of bundle.contacts) {
      expect(c.tags?.length ?? 0).toBeGreaterThan(0)
    }
  })

  test('every contact has a priority', () => {
    for (const c of bundle.contacts) {
      expect(typeof c.priority).toBe('number')
    }
  })

  test('density: phones in [42, 48]', () => {
    const phones = bundle.contacts.filter((c) => (c.phones?.length ?? 0) > 0).length
    expect(phones).toBeGreaterThanOrEqual(42)
    expect(phones).toBeLessThanOrEqual(48)
  })

  test('density: emails in [37, 43]', () => {
    const emails = bundle.contacts.filter((c) => (c.emails?.length ?? 0) > 0).length
    expect(emails).toBeGreaterThanOrEqual(37)
    expect(emails).toBeLessThanOrEqual(43)
  })

  test('density: addresses in [15, 21]', () => {
    const addresses = bundle.contacts.filter((c) => (c.addresses?.length ?? 0) > 0).length
    expect(addresses).toBeGreaterThanOrEqual(15)
    expect(addresses).toBeLessThanOrEqual(21)
  })

  test('density: events in [27, 33]', () => {
    const events = bundle.contacts.filter((c) => (c.events?.length ?? 0) > 0).length
    expect(events).toBeGreaterThanOrEqual(27)
    expect(events).toBeLessThanOrEqual(33)
  })

  test('density: organizations in [22, 28]', () => {
    const orgs = bundle.contacts.filter((c) => (c.organizations?.length ?? 0) > 0).length
    expect(orgs).toBeGreaterThanOrEqual(22)
    expect(orgs).toBeLessThanOrEqual(28)
  })

  test('density: relationsInternal in [17, 23]', () => {
    const rels = bundle.contacts.filter((c) => (c.relationsInternal?.length ?? 0) > 0).length
    expect(rels).toBeGreaterThanOrEqual(17)
    expect(rels).toBeLessThanOrEqual(23)
  })

  test('density: notesMd non-empty in [22, 28]', () => {
    const notes = bundle.contacts.filter((c) => c.notesMd && c.notesMd.trim().length > 0).length
    expect(notes).toBeGreaterThanOrEqual(22)
    expect(notes).toBeLessThanOrEqual(28)
  })

  test('density: lastContactedAt in [32, 38]', () => {
    const lc = bundle.contacts.filter((c) => c.lastContactedAt != null).length
    expect(lc).toBeGreaterThanOrEqual(32)
    expect(lc).toBeLessThanOrEqual(38)
  })

  test('all customFields keys reference one of the returned defs', () => {
    const defIds = new Set(bundle.customFieldDefs.map((d) => d.id))
    for (const c of bundle.contacts) {
      for (const k of Object.keys(c.customFields ?? {})) {
        expect(defIds.has(k)).toBe(true)
      }
    }
  })

  test('returns 7 distinct groups', () => {
    expect(bundle.groups.length).toBe(7)
  })

  test('returns 3 customFieldDefs', () => {
    expect(bundle.customFieldDefs.length).toBe(3)
    const names = bundle.customFieldDefs.map((d) => d.name).sort()
    expect(names).toEqual(['bonusCardNumber', 'metAt', 'preferredCoffee'])
  })
})

describe('buildDemoContacts (ru)', () => {
  const bundle = buildDemoContacts('ru', 'TEST_DEV')

  test('returns exactly 50 contacts', () => {
    expect(bundle.contacts.length).toBe(50)
  })

  test('parity with en in phones/emails/addresses (within ±3)', () => {
    const en = buildDemoContacts('en', 'TEST_DEV')
    const cnt = (cs: typeof bundle.contacts, k: 'phones' | 'emails' | 'addresses') =>
      cs.filter((c) => ((c[k] as unknown[] | undefined)?.length ?? 0) > 0).length
    expect(
      Math.abs(cnt(bundle.contacts, 'phones') - cnt(en.contacts, 'phones')),
    ).toBeLessThanOrEqual(3)
    expect(
      Math.abs(cnt(bundle.contacts, 'emails') - cnt(en.contacts, 'emails')),
    ).toBeLessThanOrEqual(3)
    expect(
      Math.abs(cnt(bundle.contacts, 'addresses') - cnt(en.contacts, 'addresses')),
    ).toBeLessThanOrEqual(3)
  })

  test('all relationsInternal contactIds resolve within bundle', () => {
    const allIds = new Set(bundle.contacts.map((c) => c.id))
    for (const c of bundle.contacts) {
      for (const r of c.relationsInternal ?? []) {
        expect(allIds.has(r.contactId)).toBe(true)
      }
    }
  })

  test('every contact has at least one group', () => {
    for (const c of bundle.contacts) {
      expect(c.groups?.length ?? 0).toBeGreaterThan(0)
    }
  })

  test('every contact has at least one tag', () => {
    for (const c of bundle.contacts) {
      expect(c.tags?.length ?? 0).toBeGreaterThan(0)
    }
  })

  test('returns 7 distinct groups', () => {
    expect(bundle.groups.length).toBe(7)
  })
})

describe('loadDemo + getDemoSeed', () => {
  test('inserts 50 contacts and marks meta.demo_seeded; second call rejected', async () => {
    const db = await openWaSqliteAdapter('demo-load')
    await applyMigrations(db)
    await initDevice(db)
    const did = await getDeviceId(db)
    expect(await getDemoSeed(db)).toBe(null)
    await loadDemo(db, did, 'en')
    expect(await getDemoSeed(db)).toBe('en')
    const rows = await db.select<{ c: number }>(
      'SELECT COUNT(*) AS c FROM contacts WHERE deleted_at IS NULL',
    )
    expect(Number(rows[0]?.c)).toBe(50)
    await expect(loadDemo(db, did, 'ru')).rejects.toThrow(/already loaded/)
    await db.close()
  })
})
