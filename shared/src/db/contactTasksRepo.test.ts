// @vitest-environment node
// Tests for contactTasksRepo — CRUD, filtering, ordering, open/done state, and soft-delete.
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
import { makeContactTasksRepo } from './contactTasksRepo'
import { ulid } from '../ulid'
import type { Contact, ContactTask } from '../types'

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

function newTask(contactId: string, over: Partial<ContactTask> = {}): ContactTask {
  return {
    id: ulid(),
    contactId,
    text: 'Test task',
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

describe('contactTasksRepo', () => {
  test('upsert + list returns the task', async () => {
    const db = await fresh('tasks-repo-1')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeContactTasksRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const task = await repo.upsert(newTask(contact.id))

    const list = await repo.list(contact.id)
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(task.id)
    await db.close()
  })

  test('list excludes soft-deleted and excludes other contacts tasks', async () => {
    const db = await fresh('tasks-repo-2')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeContactTasksRepo(db, 'DEV')

    const c1 = await contactsRepo.upsert(newContact())
    const c2 = await contactsRepo.upsert(newContact())
    const t1 = await repo.upsert(newTask(c1.id))
    await repo.upsert(newTask(c2.id)) // different contact
    const t3 = await repo.upsert(newTask(c1.id))
    await repo.softDelete(t3.id) // soft-deleted

    const list = await repo.list(c1.id)
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(t1.id)
    await db.close()
  })

  test('list ordering: open tasks first, then ASC by due_at NULLS LAST', async () => {
    const db = await fresh('tasks-repo-3')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeContactTasksRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const doneTask = await repo.upsert(newTask(contact.id, { text: 'done', dueAt: '2026-01-01' }))
    await repo.markDone(doneTask.id, new Date().toISOString())
    const openWithDue = await repo.upsert(
      newTask(contact.id, { text: 'open-due', dueAt: '2026-05-01' }),
    )
    const openNoDue = await repo.upsert(newTask(contact.id, { text: 'open-no-due' }))

    const list = await repo.list(contact.id)
    // open tasks first, then done; among open: due_at ASC NULLS LAST
    expect(list[0]!.id).toBe(openWithDue.id)
    expect(list[1]!.id).toBe(openNoDue.id)
    expect(list[2]!.id).toBe(doneTask.id)
    await db.close()
  })

  test('listAllOpen returns alive doneAt-null tasks across all contacts', async () => {
    const db = await fresh('tasks-repo-4')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeContactTasksRepo(db, 'DEV')

    const c1 = await contactsRepo.upsert(newContact())
    const c2 = await contactsRepo.upsert(newContact())
    const t1 = await repo.upsert(newTask(c1.id))
    const t2 = await repo.upsert(newTask(c2.id))
    const t3 = await repo.upsert(newTask(c1.id))
    await repo.markDone(t3.id, new Date().toISOString())

    const open = await repo.listAllOpen()
    const ids = open.map((t) => t.id)
    expect(ids).toContain(t1.id)
    expect(ids).toContain(t2.id)
    expect(ids).not.toContain(t3.id)
    await db.close()
  })

  test('listDueWithin(7): returns alive, open, dueAt within window', async () => {
    const db = await fresh('tasks-repo-5')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeContactTasksRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const now = new Date()
    const inWindow = new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10) // 3 days out
    const outWindow = new Date(now.getTime() + 10 * 86400000).toISOString().slice(0, 10) // 10 days out
    const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)

    const t1 = await repo.upsert(newTask(contact.id, { dueAt: inWindow }))
    await repo.upsert(newTask(contact.id, { dueAt: outWindow })) // outside window
    await repo.upsert(newTask(contact.id, { dueAt: yesterday })) // before now
    await repo.upsert(newTask(contact.id)) // no due date

    const result = await repo.listDueWithin(7)
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe(t1.id)
    await db.close()
  })

  test('markDone sets doneAt; subsequent listAllOpen excludes it', async () => {
    const db = await fresh('tasks-repo-6')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeContactTasksRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const task = await repo.upsert(newTask(contact.id))
    await repo.markDone(task.id, new Date().toISOString())

    const open = await repo.listAllOpen()
    expect(open.map((t) => t.id)).not.toContain(task.id)
    await db.close()
  })

  test('reopen clears doneAt; listAllOpen includes again', async () => {
    const db = await fresh('tasks-repo-7')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeContactTasksRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const task = await repo.upsert(newTask(contact.id))
    await repo.markDone(task.id, new Date().toISOString())
    await repo.reopen(task.id)

    const open = await repo.listAllOpen()
    expect(open.map((t) => t.id)).toContain(task.id)
    await db.close()
  })

  test('markDone and reopen both bump lamport_ts', async () => {
    const db = await fresh('tasks-repo-8')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeContactTasksRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const task = await repo.upsert(newTask(contact.id))
    const ltsAfterUpsert = task.lamportTs

    await repo.markDone(task.id, new Date().toISOString())
    // Fetch via list to confirm lamport bumped
    const allAfterDone = await repo.list(contact.id)
    const ltsAfterDone = allAfterDone[0]!.lamportTs
    expect(ltsAfterDone).toBeGreaterThan(ltsAfterUpsert)

    await repo.reopen(task.id)
    const allAfterReopen = await repo.list(contact.id)
    const ltsAfterReopen = allAfterReopen[0]!.lamportTs
    expect(ltsAfterReopen).toBeGreaterThan(ltsAfterDone)
    await db.close()
  })

  test('softDelete: tombstone, list returns 0', async () => {
    const db = await fresh('tasks-repo-9')
    const contactsRepo = makeContactsRepo(db, 'DEV')
    const repo = makeContactTasksRepo(db, 'DEV')

    const contact = await contactsRepo.upsert(newContact())
    const task = await repo.upsert(newTask(contact.id))
    await repo.softDelete(task.id)

    const list = await repo.list(contact.id)
    expect(list).toHaveLength(0)
    await db.close()
  })
})
