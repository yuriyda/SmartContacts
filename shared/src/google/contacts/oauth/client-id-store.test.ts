// @vitest-environment node
// Tests for client-id-store.ts — CRUD on meta table key 'google_contacts.oauth_client_id'.

import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { openWaSqliteAdapter } from '../../../db/wa-sqlite-backend'
import { applyMigrations } from '../../../db/migrations'
import { makeClientIdStore } from './client-id-store'

async function freshDb(name: string) {
  const db = await openWaSqliteAdapter(name)
  await applyMigrations(db)
  return db
}

describe('makeClientIdStore', () => {
  it('get() on empty meta returns null', async () => {
    const db = await freshDb('client-id-store-test-1')
    const store = makeClientIdStore(db)
    expect(await store.get()).toBeNull()
    await db.close()
  })

  it('set(x) + get() returns x', async () => {
    const db = await freshDb('client-id-store-test-2')
    const store = makeClientIdStore(db)
    await store.set('123-abc.apps.googleusercontent.com')
    expect(await store.get()).toBe('123-abc.apps.googleusercontent.com')
    await db.close()
  })

  it('set(x) then set(y) (upsert) — get() returns y', async () => {
    const db = await freshDb('client-id-store-test-3')
    const store = makeClientIdStore(db)
    await store.set('first-client-id')
    await store.set('second-client-id')
    expect(await store.get()).toBe('second-client-id')
    await db.close()
  })

  it('clear() then get() returns null', async () => {
    const db = await freshDb('client-id-store-test-4')
    const store = makeClientIdStore(db)
    await store.set('some-client-id')
    await store.clear()
    expect(await store.get()).toBeNull()
    await db.close()
  })
})
