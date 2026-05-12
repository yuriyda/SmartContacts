// @vitest-environment node
// Tests for LabelRepo — full-replace semantics (INV-4), memberships, cascade delete.
// Uses a real wa-sqlite in-memory database per test suite to verify end-to-end SQL behavior.
//
// Rules:
//  - Each describe block creates its own isolated DB to avoid state leakage.
//  - fake-indexeddb/auto must be imported first to provide IndexedDB in Node.
//  - Do NOT mock DbAdapter — test against the real wa-sqlite backend.

import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { openWaSqliteAdapter } from '../../../db/wa-sqlite-backend'
import { applyMigrations } from '../../../db/migrations'
import { makeContactsRepo } from '../../../db/contactsRepo'
import { ulid } from '../../../ulid'
import { LabelRepo } from './label-repo'
import type { GoogleLabelRow } from './label-repo'
import type { DbAdapter } from '../../../db/adapter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dbCounter = 0

async function freshDb(): Promise<DbAdapter> {
  dbCounter++
  const db = await openWaSqliteAdapter(`label-repo-test-${dbCounter}`)
  await applyMigrations(db)
  return db
}

function makeLabel(override: Partial<GoogleLabelRow> = {}): GoogleLabelRow {
  return {
    resourceName: 'contactGroups/default',
    name: 'Default',
    groupType: 'system',
    etag: 'etag-1',
    lastSyncedAt: new Date().toISOString(),
    ...override,
  }
}

const labelA: GoogleLabelRow = makeLabel({
  resourceName: 'contactGroups/a',
  name: 'Friends',
  groupType: 'user',
  etag: 'etag-a',
})

const labelB: GoogleLabelRow = makeLabel({
  resourceName: 'contactGroups/b',
  name: 'Family',
  groupType: 'user',
  etag: 'etag-b',
})

const labelC: GoogleLabelRow = makeLabel({
  resourceName: 'contactGroups/c',
  name: 'Work',
  groupType: 'user',
  etag: 'etag-c',
})

// ---------------------------------------------------------------------------
// Seed a minimal contact to satisfy FK constraints on memberships
// ---------------------------------------------------------------------------

async function seedContact(db: DbAdapter): Promise<string> {
  const repo = makeContactsRepo(db, 'DEV')
  const contact = await repo.upsert({
    id: ulid(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lamportTs: 0,
    deviceId: 'DEV',
    displayName: 'Test Contact',
  })
  return contact.id
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('LabelRepo: replaceAll adds both labels and listAll returns them', () => {
  let db: DbAdapter
  let repo: LabelRepo

  beforeAll(async () => {
    db = await freshDb()
    repo = new LabelRepo(db)
    await repo.replaceAll([labelA, labelB])
  })

  it('case a: listAll returns both labels after replaceAll([a, b])', async () => {
    const all = await repo.listAll()
    const names = all.map((l) => l.resourceName).sort()
    expect(names).toEqual(['contactGroups/a', 'contactGroups/b'])
  })
})

describe('LabelRepo: full-replace semantics — second replaceAll replaces, not appends', () => {
  let db: DbAdapter
  let repo: LabelRepo

  beforeAll(async () => {
    db = await freshDb()
    repo = new LabelRepo(db)
    await repo.replaceAll([labelA, labelB])
    await repo.replaceAll([labelC])
  })

  it('case b: listAll returns only c after replaceAll([c])', async () => {
    const all = await repo.listAll()
    expect(all).toHaveLength(1)
    expect(all[0]!.resourceName).toBe('contactGroups/c')
  })
})

describe('LabelRepo: replaceMembershipsForContact — set and query', () => {
  let db: DbAdapter
  let repo: LabelRepo
  let contactId: string

  beforeAll(async () => {
    db = await freshDb()
    repo = new LabelRepo(db)
    contactId = await seedContact(db)
    await repo.replaceAll([labelA])
    await repo.replaceMembershipsForContact(contactId, ['contactGroups/a'])
  })

  it('case c: listForContact returns the label after membership is set', async () => {
    const labels = await repo.listForContact(contactId)
    expect(labels).toHaveLength(1)
    expect(labels[0]!.resourceName).toBe('contactGroups/a')
  })
})

describe('LabelRepo: replaceMembershipsForContact — empty list clears contact memberships', () => {
  let db: DbAdapter
  let repo: LabelRepo
  let contactId: string

  beforeAll(async () => {
    db = await freshDb()
    repo = new LabelRepo(db)
    contactId = await seedContact(db)
    await repo.replaceAll([labelA])
    await repo.replaceMembershipsForContact(contactId, ['contactGroups/a'])
    // Replace with empty — should clear
    await repo.replaceMembershipsForContact(contactId, [])
  })

  it('case d: listForContact returns empty after replaceMembershipsForContact(id, [])', async () => {
    const labels = await repo.listForContact(contactId)
    expect(labels).toHaveLength(0)
  })
})

describe('LabelRepo: clearAll empties both tables', () => {
  let db: DbAdapter
  let repo: LabelRepo
  let contactId: string

  beforeAll(async () => {
    db = await freshDb()
    repo = new LabelRepo(db)
    contactId = await seedContact(db)
    await repo.replaceAll([labelA, labelB])
    await repo.replaceMembershipsForContact(contactId, ['contactGroups/a'])
    await repo.clearAll()
  })

  it('case e: listAll returns empty after clearAll', async () => {
    const all = await repo.listAll()
    expect(all).toHaveLength(0)
  })

  it('case e: listForContact returns empty after clearAll', async () => {
    const labels = await repo.listForContact(contactId)
    expect(labels).toHaveLength(0)
  })
})

describe('LabelRepo: cascade delete — deleting a label cascades to memberships', () => {
  let db: DbAdapter
  let repo: LabelRepo
  let contactId: string

  beforeAll(async () => {
    db = await freshDb()
    repo = new LabelRepo(db)
    contactId = await seedContact(db)
    await repo.replaceAll([labelA])
    await repo.replaceMembershipsForContact(contactId, ['contactGroups/a'])
    // Enable FK enforcement (required for ON DELETE CASCADE in wa-sqlite)
    await db.execute('PRAGMA foreign_keys = ON')
    // Delete label directly via SQL to test cascade
    await db.execute('DELETE FROM google_labels WHERE resource_name = ?', ['contactGroups/a'])
  })

  it('case f: memberships are cascade-deleted when label is deleted', async () => {
    const rows = await db.select<{ contact_id: string }>(
      'SELECT contact_id FROM google_label_memberships WHERE contact_id = ?',
      [contactId],
    )
    expect(rows).toHaveLength(0)
  })
})
