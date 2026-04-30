// lookupGc.test.ts — Tests for tags_index / groups_index GC logic.
// Verifies rebuild on insert, removal on soft-delete, rename on group update,
// idempotency, and restore behaviour.
//
// Rules:
//  - Each test uses a fresh DB instance with a unique name to avoid cross-test pollution.
//  - All assertions go through the public repo API to match real usage patterns.

// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from './wa-sqlite-backend'
import { applyMigrations } from './migrations'
import { initDevice, getDeviceId } from './init'
import { makeContactsRepo } from './contactsRepo'
import { runLookupGc } from './lookupGc'
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

describe('runLookupGc', () => {
  test('rebuilds tags_index from alive contacts', async () => {
    const db = await fresh('lookup-gc-tags')
    const did = await getDeviceId(db)
    const repo = makeContactsRepo(db, did)
    await repo.upsert(newContact({ tags: ['a', 'b'] }))
    await repo.upsert(newContact({ tags: ['b', 'c'] }))
    // upsert calls runLookupGc internally now (after Step 3 wiring).
    const tags = await db.select<{ name: string }>('SELECT name FROM tags_index ORDER BY name')
    expect(tags.map((t) => t.name)).toEqual(['a', 'b', 'c'])
    await db.close()
  })

  test('removes tag when last contact using it is soft-deleted', async () => {
    const db = await fresh('lookup-gc-soft-delete')
    const did = await getDeviceId(db)
    const repo = makeContactsRepo(db, did)
    const c1 = await repo.upsert(newContact({ tags: ['x', 'y'] }))
    await repo.upsert(newContact({ tags: ['y'] }))
    await repo.softDelete(c1.id)
    const tags = await db.select<{ name: string }>('SELECT name FROM tags_index ORDER BY name')
    // 'x' should be gone, 'y' still present
    expect(tags.map((t) => t.name)).toEqual(['y'])
    await db.close()
  })

  test('groups_index keeps id->name and updates on rename', async () => {
    const db = await fresh('lookup-gc-groups')
    const did = await getDeviceId(db)
    const repo = makeContactsRepo(db, did)
    const c = await repo.upsert(newContact({ groups: [{ id: 'g_w', name: 'Work' }] }))
    let rows = await db.select<{ id: string; name: string }>('SELECT id, name FROM groups_index')
    expect(rows).toEqual([{ id: 'g_w', name: 'Work' }])

    // Rename via upsert
    await repo.upsert({ ...c, groups: [{ id: 'g_w', name: 'Office' }] })
    rows = await db.select<{ id: string; name: string }>('SELECT id, name FROM groups_index')
    expect(rows).toEqual([{ id: 'g_w', name: 'Office' }])
    await db.close()
  })

  test('runLookupGc is idempotent on a stable dataset', async () => {
    const db = await fresh('lookup-gc-idempotent')
    const did = await getDeviceId(db)
    const repo = makeContactsRepo(db, did)
    await repo.upsert(newContact({ tags: ['a', 'b'], groups: [{ id: 'g', name: 'G' }] }))
    const before = await db.select('SELECT COUNT(*) AS n FROM tags_index')
    await db.transaction(async (tx) => runLookupGc(tx))
    const after = await db.select('SELECT COUNT(*) AS n FROM tags_index')
    expect((before[0] as { n: number }).n).toBe((after[0] as { n: number }).n)
    await db.close()
  })

  test('restore re-adds tags after soft-delete cleared them', async () => {
    const db = await fresh('lookup-gc-restore')
    const did = await getDeviceId(db)
    const repo = makeContactsRepo(db, did)
    const c = await repo.upsert(newContact({ tags: ['z'] }))
    await repo.softDelete(c.id)
    let rows = await db.select<{ name: string }>('SELECT name FROM tags_index')
    expect(rows.length).toBe(0)
    await repo.restore(c.id)
    rows = await db.select<{ name: string }>('SELECT name FROM tags_index')
    expect(rows.map((r) => r.name)).toEqual(['z'])
    await db.close()
  })
})
