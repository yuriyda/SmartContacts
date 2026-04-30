// @vitest-environment node
// Tests for contactsRepo — full CRUD, search, aggregation, and bulk operations.
// Uses a real wa-sqlite in-memory database per test to verify end-to-end SQL behavior.
// Rules:
//  - Each test creates its own isolated DB (unique name) to avoid state leakage.
//  - fake-indexeddb/auto must be imported before openWaSqliteAdapter to provide IndexedDB in Node.
//  - Do NOT mock DbAdapter — test against the real wa-sqlite backend.

import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from './wa-sqlite-backend'
import { applyMigrations } from './migrations'
import { makeContactsRepo } from './contactsRepo'
import { ulid } from '../ulid'
import type { Contact } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fresh(name: string) {
  return openWaSqliteAdapter(name).then(async (db) => {
    await applyMigrations(db)
    return db
  })
}

function newContact(over: Partial<Contact> = {}): Contact {
  return {
    id: ulid(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lamportTs: 0,
    deviceId: 'DEV',
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('contactsRepo', () => {
  test('upsert + getById + list round-trip; lamport advances', async () => {
    const db = await fresh('contacts-repo-1')
    const repo = makeContactsRepo(db, 'DEV')
    const a = await repo.upsert(newContact({ displayName: 'Alpha' }))
    const b = await repo.upsert(newContact({ displayName: 'Beta' }))
    expect(a.lamportTs).toBe(1)
    expect(b.lamportTs).toBe(2)
    expect((await repo.getById(a.id))?.displayName).toBe('Alpha')
    const all = await repo.list()
    expect(all.map((c) => c.displayName).sort()).toEqual(['Alpha', 'Beta'])
    await db.close()
  })

  test('softDelete hides from default list, restore brings back', async () => {
    const db = await fresh('contacts-repo-2')
    const repo = makeContactsRepo(db, 'DEV')
    const c = await repo.upsert(newContact({ displayName: 'X' }))
    await repo.softDelete(c.id)
    expect((await repo.list()).length).toBe(0)
    expect((await repo.list({ includeDeleted: true })).length).toBe(1)
    await repo.restore(c.id)
    expect((await repo.list()).length).toBe(1)
    await db.close()
  })

  test('hardDelete removes the row', async () => {
    const db = await fresh('contacts-repo-3')
    const repo = makeContactsRepo(db, 'DEV')
    const c = await repo.upsert(newContact({ displayName: 'X' }))
    await repo.hardDelete(c.id)
    expect(await repo.getById(c.id)).toBe(null)
    await db.close()
  })

  test('touch updates lastContactedAt and bumps lamport', async () => {
    const db = await fresh('contacts-repo-4')
    const repo = makeContactsRepo(db, 'DEV')
    const c = await repo.upsert(newContact({ displayName: 'X' }))
    expect(c.lamportTs).toBe(1)
    await new Promise((r) => setTimeout(r, 5))
    await repo.touch(c.id)
    const after = await repo.getById(c.id)
    expect(after?.lastContactedAt).toBeTruthy()
    expect(after?.lamportTs).toBe(2)
    await db.close()
  })

  test('searchByName matches display/given/family/nickname case-insensitively', async () => {
    const db = await fresh('contacts-repo-5')
    const repo = makeContactsRepo(db, 'DEV')
    await repo.upsert(newContact({ displayName: 'Иван Иванов', givenName: 'Иван' }))
    await repo.upsert(newContact({ displayName: 'Anna Smith', givenName: 'Anna' }))
    await repo.upsert(newContact({ displayName: 'Bob', nickname: 'Bobby' }))
    expect((await repo.searchByName('иван')).length).toBe(1)
    expect((await repo.searchByName('SMITH')).length).toBe(1)
    expect((await repo.searchByName('bobby')).length).toBe(1)
    await db.close()
  })

  test('countAlive ignores soft-deleted', async () => {
    const db = await fresh('contacts-repo-6')
    const repo = makeContactsRepo(db, 'DEV')
    const a = await repo.upsert(newContact())
    await repo.upsert(newContact())
    await repo.softDelete(a.id)
    expect(await repo.countAlive()).toBe(1)
    await db.close()
  })

  test('birthdaysThisMonth filters by month of event.date', async () => {
    const db = await fresh('contacts-repo-7')
    const repo = makeContactsRepo(db, 'DEV')
    await repo.upsert(
      newContact({ displayName: 'Apr', events: [{ date: '1990-04-15', type: 'birthday' }] }),
    )
    await repo.upsert(
      newContact({ displayName: 'May', events: [{ date: '1990-05-20', type: 'birthday' }] }),
    )
    const today = new Date('2026-04-29T12:00:00.000Z')
    const out = await repo.birthdaysThisMonth(today)
    expect(out.map((c) => c.displayName)).toEqual(['Apr'])
    await db.close()
  })

  test('recentByLastContacted sorts desc and respects limit', async () => {
    const db = await fresh('contacts-repo-8')
    const repo = makeContactsRepo(db, 'DEV')
    const a = await repo.upsert(newContact({ displayName: 'A' }))
    const b = await repo.upsert(newContact({ displayName: 'B' }))
    const c = await repo.upsert(newContact({ displayName: 'C' }))
    await repo.touch(a.id)
    await new Promise((r) => setTimeout(r, 5))
    await repo.touch(b.id)
    await new Promise((r) => setTimeout(r, 5))
    await repo.touch(c.id)
    const out = await repo.recentByLastContacted(2)
    expect(out.map((x) => x.displayName)).toEqual(['C', 'B'])
    await db.close()
  })

  test('bulkLoad inserts many contacts in one go and bumps lamport per row', async () => {
    const db = await fresh('contacts-repo-9')
    const repo = makeContactsRepo(db, 'DEV')
    const arr: Contact[] = Array.from({ length: 50 }, (_, i) =>
      newContact({ displayName: `C${i + 1}` }),
    )
    await repo.bulkLoad(arr)
    expect(await repo.countAlive()).toBe(50)
    const last = await repo.getById(arr[49]!.id)
    expect(last?.lamportTs).toBe(50)
    await db.close()
  })
})
