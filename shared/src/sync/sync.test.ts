// @vitest-environment node
// sync.test.ts — Integration tests for the state-based Lamport sync engine.
// Tests cover: shouldReplace conflict resolution, two-device convergence,
// tie-breaking, tombstone propagation, full export, lookup table rebuild,
// custom field def sync, interaction sync (P8.A.3), and contact_task sync (P8.A.3).
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
import { makeInteractionsRepo } from '../db/interactionsRepo'
import { makeContactTasksRepo } from '../db/contactTasksRepo'
import { buildSyncRequest, computeSyncPackage, importSyncPackage, shouldReplace } from './sync'
import { ulid } from '../ulid'
import type { Contact, Interaction, ContactTask } from '../types'

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

function newInteraction(over: Partial<Interaction> = {}): Interaction {
  return {
    id: ulid(),
    contactId: '',
    at: new Date().toISOString(),
    channel: 'call',
    createdAt: '',
    updatedAt: '',
    lamportTs: 0,
    deviceId: '',
    ...over,
  }
}

function newTask(over: Partial<ContactTask> = {}): ContactTask {
  return {
    id: ulid(),
    contactId: '',
    text: 'todo',
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

// ---------------------------------------------------------------------------
// P8.A.3: Interaction sync tests
// ---------------------------------------------------------------------------

describe('sync engine — interactions (P8.A.3)', () => {
  test('two devices converge: all interactions present after bidirectional sync', async () => {
    const dbA = await fresh('itr-conv-a')
    const dbB = await fresh('itr-conv-b')
    const didA = await getDeviceId(dbA)
    const didB = await getDeviceId(dbB)

    // Both devices need a shared contact (interactions reference contacts via FK)
    const contactId = ulid()
    const repoCA = makeContactsRepo(dbA, didA)
    const repoCB = makeContactsRepo(dbB, didB)
    await repoCA.upsert(newContact({ id: contactId, displayName: 'Shared' }))
    await repoCB.upsert(newContact({ id: contactId, displayName: 'Shared' }))

    const repoA = makeInteractionsRepo(dbA, didA)
    const repoB = makeInteractionsRepo(dbB, didB)

    // A inserts 3 interactions, B inserts 2 different interactions
    await repoA.upsert(newInteraction({ contactId, channel: 'call' }))
    await repoA.upsert(newInteraction({ contactId, channel: 'email' }))
    await repoA.upsert(newInteraction({ contactId, channel: 'meet' }))
    await repoB.upsert(newInteraction({ contactId, channel: 'message' }))
    await repoB.upsert(newInteraction({ contactId, channel: 'social' }))

    // Bidirectional sync: A→B then B→A
    const pkgA = await computeSyncPackage(dbA, {})
    const { response: pkgB } = await importSyncPackage(dbB, pkgA)
    await importSyncPackage(dbA, pkgB)

    const aList = await repoA.list(contactId)
    const bList = await repoB.list(contactId)
    expect(aList.length).toBe(5)
    expect(bList.length).toBe(5)
    expect(aList.map((i) => i.channel).sort()).toEqual([
      'call',
      'email',
      'meet',
      'message',
      'social',
    ])
    expect(bList.map((i) => i.channel).sort()).toEqual([
      'call',
      'email',
      'meet',
      'message',
      'social',
    ])

    await dbA.close()
    await dbB.close()
  })

  test('tie-break: same lamport on same interaction — higher deviceId wins', async () => {
    const dbA = await fresh('itr-tie-a')
    const dbB = await fresh('itr-tie-b')
    const didA = await getDeviceId(dbA)
    const didB = await getDeviceId(dbB)

    const contactId = ulid()
    const repoCA = makeContactsRepo(dbA, didA)
    const repoCB = makeContactsRepo(dbB, didB)
    await repoCA.upsert(newContact({ id: contactId, displayName: 'Shared' }))
    await repoCB.upsert(newContact({ id: contactId, displayName: 'Shared' }))

    const repoA = makeInteractionsRepo(dbA, didA)
    const repoB = makeInteractionsRepo(dbB, didB)

    // Both devices independently edit the same interaction id — both get lamport_ts=1
    const sharedId = ulid()
    await repoA.upsert(newInteraction({ id: sharedId, contactId, noteMd: 'A-note' }))
    await repoB.upsert(newInteraction({ id: sharedId, contactId, noteMd: 'B-note' }))

    // Both now have lamportTs=1; tie-break by deviceId
    const pkgA = await computeSyncPackage(dbA, {})
    await importSyncPackage(dbB, pkgA)
    const pkgB = await computeSyncPackage(dbB, {})
    await importSyncPackage(dbA, pkgB)

    const winner = didA > didB ? 'A-note' : 'B-note'
    const rowsA = await dbA.select<{ note_md: string | null }>(
      'SELECT note_md FROM interactions WHERE id = ?',
      [sharedId],
    )
    const rowsB = await dbB.select<{ note_md: string | null }>(
      'SELECT note_md FROM interactions WHERE id = ?',
      [sharedId],
    )
    expect(rowsA[0]?.note_md).toBe(winner)
    expect(rowsB[0]?.note_md).toBe(winner)

    await dbA.close()
    await dbB.close()
  })

  test('tombstone: A soft-deletes an interaction; B receives deletedAt after sync', async () => {
    const dbA = await fresh('itr-tomb-a')
    const dbB = await fresh('itr-tomb-b')
    const didA = await getDeviceId(dbA)
    const didB = await getDeviceId(dbB)

    const contactId = ulid()
    const repoCA = makeContactsRepo(dbA, didA)
    const repoCB = makeContactsRepo(dbB, didB)
    await repoCA.upsert(newContact({ id: contactId, displayName: 'X' }))
    await repoCB.upsert(newContact({ id: contactId, displayName: 'X' }))

    const repoA = makeInteractionsRepo(dbA, didA)
    const i2 = await repoA.upsert(newInteraction({ contactId, channel: 'call' }))

    // Initial sync: B gets the interaction
    await importSyncPackage(dbB, await computeSyncPackage(dbA, {}))
    const bListBefore = await repoA.list(contactId)
    expect(bListBefore.length).toBe(1)

    // A soft-deletes i2
    await repoA.softDelete(i2.id)

    // Delta sync: only the tombstone goes
    const bVC = (await buildSyncRequest(dbB)).vectorClock
    await importSyncPackage(dbB, await computeSyncPackage(dbA, bVC))

    const bRows = await dbB.select<{ id: string; deleted_at: string | null }>(
      'SELECT id, deleted_at FROM interactions WHERE id = ?',
      [i2.id],
    )
    expect(bRows[0]?.deleted_at).toBeTruthy()

    await dbA.close()
    await dbB.close()
  })
})

// ---------------------------------------------------------------------------
// P8.A.3: ContactTask sync tests
// ---------------------------------------------------------------------------

describe('sync engine — contact_tasks (P8.A.3)', () => {
  test('two devices converge: all tasks present after bidirectional sync', async () => {
    const dbA = await fresh('task-conv-a')
    const dbB = await fresh('task-conv-b')
    const didA = await getDeviceId(dbA)
    const didB = await getDeviceId(dbB)

    const contactId = ulid()
    const repoCA = makeContactsRepo(dbA, didA)
    const repoCB = makeContactsRepo(dbB, didB)
    await repoCA.upsert(newContact({ id: contactId, displayName: 'Shared' }))
    await repoCB.upsert(newContact({ id: contactId, displayName: 'Shared' }))

    const repoA = makeContactTasksRepo(dbA, didA)
    const repoB = makeContactTasksRepo(dbB, didB)

    await repoA.upsert(newTask({ contactId, text: 'A-task-1' }))
    await repoA.upsert(newTask({ contactId, text: 'A-task-2' }))
    await repoA.upsert(newTask({ contactId, text: 'A-task-3' }))
    await repoB.upsert(newTask({ contactId, text: 'B-task-1' }))
    await repoB.upsert(newTask({ contactId, text: 'B-task-2' }))

    const pkgA = await computeSyncPackage(dbA, {})
    const { response: pkgB } = await importSyncPackage(dbB, pkgA)
    await importSyncPackage(dbA, pkgB)

    const aList = await repoA.list(contactId)
    const bList = await repoB.list(contactId)
    expect(aList.length).toBe(5)
    expect(bList.length).toBe(5)
    expect(aList.map((t) => t.text).sort()).toEqual([
      'A-task-1',
      'A-task-2',
      'A-task-3',
      'B-task-1',
      'B-task-2',
    ])
    expect(bList.map((t) => t.text).sort()).toEqual([
      'A-task-1',
      'A-task-2',
      'A-task-3',
      'B-task-1',
      'B-task-2',
    ])

    await dbA.close()
    await dbB.close()
  })

  test('tie-break on text field with same lamport — higher deviceId wins', async () => {
    const dbA = await fresh('task-tie-a')
    const dbB = await fresh('task-tie-b')
    const didA = await getDeviceId(dbA)
    const didB = await getDeviceId(dbB)

    const contactId = ulid()
    const repoCA = makeContactsRepo(dbA, didA)
    const repoCB = makeContactsRepo(dbB, didB)
    await repoCA.upsert(newContact({ id: contactId, displayName: 'Shared' }))
    await repoCB.upsert(newContact({ id: contactId, displayName: 'Shared' }))

    const repoA = makeContactTasksRepo(dbA, didA)
    const repoB = makeContactTasksRepo(dbB, didB)

    // Same id, both edit independently — both get lamport_ts=1
    const sharedId = ulid()
    await repoA.upsert(newTask({ id: sharedId, contactId, text: 'A-text' }))
    await repoB.upsert(newTask({ id: sharedId, contactId, text: 'B-text' }))

    const pkgA = await computeSyncPackage(dbA, {})
    await importSyncPackage(dbB, pkgA)
    const pkgB = await computeSyncPackage(dbB, {})
    await importSyncPackage(dbA, pkgB)

    const winner = didA > didB ? 'A-text' : 'B-text'
    const rowsA = await dbA.select<{ text: string }>(
      'SELECT text FROM contact_tasks WHERE id = ?',
      [sharedId],
    )
    const rowsB = await dbB.select<{ text: string }>(
      'SELECT text FROM contact_tasks WHERE id = ?',
      [sharedId],
    )
    expect(rowsA[0]?.text).toBe(winner)
    expect(rowsB[0]?.text).toBe(winner)

    await dbA.close()
    await dbB.close()
  })

  test('doneAt convergence: A marks task done; B sees doneAt after A→B sync', async () => {
    const dbA = await fresh('task-done-a')
    const dbB = await fresh('task-done-b')
    const didA = await getDeviceId(dbA)
    const didB = await getDeviceId(dbB)

    const contactId = ulid()
    const repoCA = makeContactsRepo(dbA, didA)
    const repoCB = makeContactsRepo(dbB, didB)
    await repoCA.upsert(newContact({ id: contactId, displayName: 'X' }))
    await repoCB.upsert(newContact({ id: contactId, displayName: 'X' }))

    const repoA = makeContactTasksRepo(dbA, didA)
    const t = await repoA.upsert(newTask({ contactId, text: 'Call back' }))

    // Initial sync: B gets the task
    await importSyncPackage(dbB, await computeSyncPackage(dbA, {}))

    // A marks task done
    const doneAt = new Date().toISOString()
    await repoA.markDone(t.id, doneAt)

    // Delta sync: B should receive the done state
    const bVC = (await buildSyncRequest(dbB)).vectorClock
    await importSyncPackage(dbB, await computeSyncPackage(dbA, bVC))

    const bRows = await dbB.select<{ id: string; done_at: string | null }>(
      'SELECT id, done_at FROM contact_tasks WHERE id = ?',
      [t.id],
    )
    expect(bRows[0]?.done_at).toBeTruthy()

    await dbA.close()
    await dbB.close()
  })

  test('tombstone: A soft-deletes a task; B receives deletedAt after sync', async () => {
    const dbA = await fresh('task-tomb-a')
    const dbB = await fresh('task-tomb-b')
    const didA = await getDeviceId(dbA)
    const didB = await getDeviceId(dbB)

    const contactId = ulid()
    const repoCA = makeContactsRepo(dbA, didA)
    const repoCB = makeContactsRepo(dbB, didB)
    await repoCA.upsert(newContact({ id: contactId, displayName: 'X' }))
    await repoCB.upsert(newContact({ id: contactId, displayName: 'X' }))

    const repoA = makeContactTasksRepo(dbA, didA)
    const t = await repoA.upsert(newTask({ contactId, text: 'Doomed task' }))

    // Initial sync: B gets the task
    await importSyncPackage(dbB, await computeSyncPackage(dbA, {}))

    // A soft-deletes the task
    await repoA.softDelete(t.id)

    // Delta sync: only tombstone goes to B
    const bVC = (await buildSyncRequest(dbB)).vectorClock
    await importSyncPackage(dbB, await computeSyncPackage(dbA, bVC))

    const bRows = await dbB.select<{ id: string; deleted_at: string | null }>(
      'SELECT id, deleted_at FROM contact_tasks WHERE id = ?',
      [t.id],
    )
    expect(bRows[0]?.deleted_at).toBeTruthy()

    await dbA.close()
    await dbB.close()
  })
})
