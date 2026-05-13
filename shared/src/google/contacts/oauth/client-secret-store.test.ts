// @vitest-environment node
// Tests for client-secret-store.ts — CRUD on meta table key 'google_contacts.oauth_client_secret'.

import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { openWaSqliteAdapter } from '../../../db/wa-sqlite-backend'
import { applyMigrations } from '../../../db/migrations'
import { makeClientSecretStore } from './client-secret-store'

async function freshDb(name: string) {
  const db = await openWaSqliteAdapter(name)
  await applyMigrations(db)
  return db
}

describe('makeClientSecretStore', () => {
  it('get() on empty meta returns null', async () => {
    const db = await freshDb('client-secret-store-test-1')
    const store = makeClientSecretStore(db)
    expect(await store.get()).toBeNull()
    await db.close()
  })

  it('set(x) + get() returns x', async () => {
    const db = await freshDb('client-secret-store-test-2')
    const store = makeClientSecretStore(db)
    await store.set('secret-value-abc')
    expect(await store.get()).toBe('secret-value-abc')
    await db.close()
  })

  it('set(x) then set(y) (upsert) — get() returns y', async () => {
    const db = await freshDb('client-secret-store-test-3')
    const store = makeClientSecretStore(db)
    await store.set('first-secret')
    await store.set('second-secret')
    expect(await store.get()).toBe('second-secret')
    await db.close()
  })

  it('clear() then get() returns null', async () => {
    const db = await freshDb('client-secret-store-test-4')
    const store = makeClientSecretStore(db)
    await store.set('some-secret')
    await store.clear()
    expect(await store.get()).toBeNull()
    await db.close()
  })
})
