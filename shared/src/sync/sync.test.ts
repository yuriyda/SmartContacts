// @vitest-environment node
// sync.test.ts — Integration tests for the state-based Lamport sync engine.
// Tests cover: shouldReplace conflict resolution, two-device convergence,
// tie-breaking, tombstone propagation, full export, lookup table rebuild,
// and custom field def sync.
//
// Rules:
//  - Each test uses a fresh in-memory wa-sqlite DB with a unique name.
//  - fake-indexeddb provides the IndexedDB implementation used by wa-sqlite.
//  - Do NOT import from node:* directly; use vitest helpers.

import 'fake-indexeddb/auto'

import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from '../db/wa-sqlite-backend'
import { applyMigrations } from '../db/migrations'
import { initDevice, getDeviceId } from '../db/init'
import { makeContactsRepo } from '../db/contactsRepo'
import { buildSyncRequest, computeSyncPackage, importSyncPackage, shouldReplace } from './sync'
import { ulid } from '../ulid'
import type { Contact } from '../types'

async function fresh(name: string) {
  const db = await openWaSqliteAdapter(name)
  await applyMigrations(db)
  await initDevice(db)
  return db
}

function newContact(over: Partial<Contact> = {}): Contact {
  return {
    id: ulid(),
    createdAt: '',
    updatedAt: '',
    lamportTs: 0,
    deviceId: '',
    ...over,
  }
}

// ---------------------------------------------------------------------------
// shouldReplace unit tests
// ---------------------------------------------------------------------------

describe('shouldReplace', () => {
  test('strictly higher lamport wins', () => {
    expect(shouldReplace(2, 1, 'a', 'a')).toBe(true)
    expect(shouldReplace(1, 2, 'a', 'a')).toBe(false)
  })

  test('tie broken by deviceId lexicographic', () => {
    expect(shouldReplace(5, 5, 'b', 'a')).toBe(true)
    expect(shouldReplace(5, 5, 'a', 'b')).toBe(false)
  })

  test('same device, same lamport: incoming loses', () => {
    expect(shouldReplace(5, 5, 'a', 'a')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Sync engine integration tests
// ---------------------------------------------------------------------------

describe('sync engine', () => {
  test('two devices converge after one round-trip', async () => {
    const dbA = await fresh('sync-a-1')
    const dbB = await fresh('sync-b-1')
    const didA = await getDeviceId(dbA)
    const didB = await getDeviceId(dbB)
    const repoA = makeContactsRepo(dbA, didA)
    const repoB = makeContactsRepo(dbB, didB)

    await repoA.upsert(newContact({ displayName: 'Alice' }))
    await repoB.upsert(newContact({ displayName: 'Bob' }))

    // A->B: A computes package for empty VC, B imports.
    const pkgFromA = await computeSyncPackage(dbA, {})
    const { response: pkgFromB } = await importSyncPackage(dbB, pkgFromA)
    // B->A: B's response goes back.
    await importSyncPackage(dbA, pkgFromB)

    const aList = await repoA.list()
    const bList = await repoB.list()
    expect(aList.map((c) => c.displayName).sort()).toEqual(['Alice', 'Bob'])
    expect(bList.map((c) => c.displayName).sort()).toEqual(['Alice', 'Bob'])

    await dbA.close()
    await dbB.close()
  })

  test('lamport tie-break converges deterministically', async () => {
    const dbA = await fresh('sync-tie-a')
    const dbB = await fresh('sync-tie-b')
    const didA = await getDeviceId(dbA)
    const didB = await getDeviceId(dbB)
    const repoA = makeContactsRepo(dbA, didA)
    const repoB = makeContactsRepo(dbB, didB)

    // Same id, both edit independently — both will get lamport_ts = 1.
    const sharedId = ulid()
    await repoA.upsert(newContact({ id: sharedId, displayName: 'A-version' }))
    await repoB.upsert(newContact({ id: sharedId, displayName: 'B-version' }))

    // Both have lamportTs=1; tie-break by deviceId — higher one wins.
    const pkgA = await computeSyncPackage(dbA, {})
    await importSyncPackage(dbB, pkgA)
    const pkgB = await computeSyncPackage(dbB, {})
    await importSyncPackage(dbA, pkgB)

    const winner = didA > didB ? 'A-version' : 'B-version'
    const a = (await repoA.list()).find((c) => c.id === sharedId)
    const b = (await repoB.list()).find((c) => c.id === sharedId)
    expect(a?.displayName).toBe(winner)
    expect(b?.displayName).toBe(winner)

    await dbA.close()
    await dbB.close()
  })

  test('tombstone propagates', async () => {
    const dbA = await fresh('sync-tomb-a')
    const dbB = await fresh('sync-tomb-b')
    const repoA = makeContactsRepo(dbA, await getDeviceId(dbA))
    const repoB = makeContactsRepo(dbB, await getDeviceId(dbB))

    const c = await repoA.upsert(newContact({ displayName: 'X' }))
    await importSyncPackage(dbB, await computeSyncPackage(dbA, {}))
    expect((await repoB.list()).map((x) => x.displayName)).toEqual(['X'])

    await repoA.softDelete(c.id)
    const aVC = JSON.parse(JSON.stringify((await buildSyncRequest(dbB)).vectorClock)) as Record<
      string,
      number
    >
    await importSyncPackage(dbB, await computeSyncPackage(dbA, aVC))
    expect(
      (await repoB.list({ includeDeleted: true })).find((x) => x.id === c.id)?.deletedAt,
    ).toBeTruthy()
    expect((await repoB.list()).length).toBe(0) // alive list excludes tombstoned

    await dbA.close()
    await dbB.close()
  })

  test('full export when targetVC empty', async () => {
    const db = await fresh('sync-full-export')
    const repo = makeContactsRepo(db, await getDeviceId(db))
    await repo.upsert(newContact({ displayName: 'C1' }))
    await repo.upsert(newContact({ displayName: 'C2' }))
    const pkg = await computeSyncPackage(db, {})
    expect(pkg.contacts.length).toBe(2)
    await db.close()
  })

  test('lookup tables rebuilt after import', async () => {
    const dbA = await fresh('sync-lookup-a')
    const dbB = await fresh('sync-lookup-b')
    const repoA = makeContactsRepo(dbA, await getDeviceId(dbA))
    await repoA.upsert(newContact({ tags: ['imported'] }))
    await importSyncPackage(dbB, await computeSyncPackage(dbA, {}))
    const tags = await dbB.select<{ name: string }>('SELECT name FROM tags_index')
    expect(tags.map((t) => t.name)).toEqual(['imported'])
    await dbA.close()
    await dbB.close()
  })

  test('custom field defs sync converge', async () => {
    const dbA = await fresh('sync-defs-a')
    const dbB = await fresh('sync-defs-b')
    const didA = await getDeviceId(dbA)
    const { makeCustomFieldDefsRepo } = await import('../db/customFieldDefsRepo')
    const repoA = makeCustomFieldDefsRepo(dbA, didA)
    await repoA.upsert({
      id: ulid(),
      name: 'metAt',
      type: 'date',
      createdAt: '',
      updatedAt: '',
      lamportTs: 0,
      deviceId: didA,
    } as never)
    await importSyncPackage(dbB, await computeSyncPackage(dbA, {}))
    const rows = await dbB.select<{ name: string }>('SELECT name FROM custom_field_defs')
    expect(rows.map((r) => r.name)).toEqual(['metAt'])
    await dbA.close()
    await dbB.close()
  })
})
