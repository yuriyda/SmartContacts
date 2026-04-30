// @vitest-environment node
// Tests for interactionsRepo — CRUD, filtering, ordering, soft-delete, and recentSince.
// Uses a real wa-sqlite in-memory database per test to verify end-to-end SQL behavior.
// Rules:
//  - Each test creates its own isolated DB (unique name) to avoid state leakage.
//  - fake-indexeddb/auto must be imported before openWaSqliteAdapter.
//  - Do NOT mock DbAdapter — test against the real wa-sqlite backend.

import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from './wa-sqlite-backend'
import { applyMigrations } from './migrations'
import { makeContactsRepo } from './contactsRepo'
import { makeInteractionsRepo } from './interactionsRepo'
import { ulid } from '../ulid'
import type { Contact, Interaction } from '../types'

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

function newInteraction(contactId: string, over: Partial<Interaction> = {}): Interaction {
  return {
    id: ulid(),
    contactId,
    at: new Date().toISOString(),
    channel: 'call',
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

describe('interactionsRepo', () => {
  test('upsert + list returns 1 interaction', async () => {
    const db = await fresh('interactions-repo-1')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeInteractionsRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const interaction = await repo.upsert(newInteraction(contact.id))

    const list = await repo.list(contact.id)
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(interaction.id)
    await db.close()
  })

  test('list filters by contactId — interactions for other contacts NOT returned', async () => {
    const db = await fresh('interactions-repo-2')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeInteractionsRepo(db, 'DEV')

    const c1 = await contactsRepo.upsert(newContact())
    const c2 = await contactsRepo.upsert(newContact())
    await repo.upsert(newInteraction(c1.id))
    await repo.upsert(newInteraction(c2.id))

    const list = await repo.list(c1.id)
    expect(list).toHaveLength(1)
    expect(list[0]!.contactId).toBe(c1.id)
    await db.close()
  })

  test('list excludes soft-deleted interactions', async () => {
    const db = await fresh('interactions-repo-3')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeInteractionsRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const interaction = await repo.upsert(newInteraction(contact.id))
    await repo.softDelete(interaction.id)

    const list = await repo.list(contact.id)
    expect(list).toHaveLength(0)
    await db.close()
  })

  test('list orders by at DESC', async () => {
    const db = await fresh('interactions-repo-4')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeInteractionsRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const earlier = '2026-01-01T10:00:00.000Z'
    const later = '2026-01-02T10:00:00.000Z'
    await repo.upsert(newInteraction(contact.id, { at: earlier }))
    await repo.upsert(newInteraction(contact.id, { at: later }))

    const list = await repo.list(contact.id)
    expect(list).toHaveLength(2)
    expect(list[0]!.at).toBe(later)
    expect(list[1]!.at).toBe(earlier)
    await db.close()
  })

  test('upsert is idempotent — same id, second upsert updates', async () => {
    const db = await fresh('interactions-repo-5')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeInteractionsRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const base = newInteraction(contact.id)
    await repo.upsert(base)
    const updated = await repo.upsert({ ...base, noteMd: 'updated note' })

    const list = await repo.list(contact.id)
    expect(list).toHaveLength(1)
    expect(list[0]!.noteMd).toBe('updated note')
    expect(updated.noteMd).toBe('updated note')
    await db.close()
  })

  test('upsert bumps lamport_ts on every write', async () => {
    const db = await fresh('interactions-repo-6')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeInteractionsRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    // contactsRepo.upsert already bumped lamport to 1
    const i1 = await repo.upsert(newInteraction(contact.id))
    const i2 = await repo.upsert(newInteraction(contact.id))

    expect(i1.lamportTs).toBeGreaterThan(0)
    expect(i2.lamportTs).toBeGreaterThan(i1.lamportTs)
    await db.close()
  })

  test('softDelete sets deletedAt; subsequent list returns 0', async () => {
    const db = await fresh('interactions-repo-7')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeInteractionsRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const interaction = await repo.upsert(newInteraction(contact.id))
    await repo.softDelete(interaction.id)

    const list = await repo.list(contact.id)
    expect(list).toHaveLength(0)
    await db.close()
  })

  test('recentSince returns only interactions with at >= since', async () => {
    const db = await fresh('interactions-repo-8')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeInteractionsRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const old = '2026-01-01T00:00:00.000Z'
    const recent = '2026-04-01T00:00:00.000Z'
    const since = '2026-03-01T00:00:00.000Z'
    await repo.upsert(newInteraction(contact.id, { at: old }))
    await repo.upsert(newInteraction(contact.id, { at: recent }))

    const result = await repo.recentSince(since)
    expect(result).toHaveLength(1)
    expect(result[0]!.at).toBe(recent)
    await db.close()
  })
})
