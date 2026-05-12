// @vitest-environment node
// Tests for ConflictRepo — insert, list, resolve, count, filter, limit, clearAll.
// Uses a real wa-sqlite in-memory database per test to verify end-to-end SQL behavior.
// Rules:
//  - Each test creates its own isolated DB (unique name) to avoid state leakage.
//  - fake-indexeddb/auto must be imported before openWaSqliteAdapter.
//  - Do NOT mock DbAdapter — test against the real wa-sqlite backend.
//  - A real contacts row must be seeded before inserting conflicts (FK ON DELETE CASCADE).

import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from '../../../db/wa-sqlite-backend'
import { applyMigrations } from '../../../db/migrations'
import { ConflictRepo } from './conflict-repo'
import type { NewConflict } from './conflict-repo'
import { ulid } from '../../../ulid'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fresh(name: string) {
  const db = await openWaSqliteAdapter(name)
  await applyMigrations(db)
  return db
}

/** Insert a minimal contacts row to satisfy the FK constraint. */
async function seedContact(db: Awaited<ReturnType<typeof fresh>>, id: string): Promise<void> {
  const now = new Date().toISOString()
  await db.execute(
    `INSERT INTO contacts (id, created_at, updated_at, lamport_ts, device_id, protected, hidden)
     VALUES (?, ?, ?, 0, 'DEV', 0, 0)`,
    [id, now, now],
  )
}

function makeConflict(contactId: string, over: Partial<NewConflict> = {}): NewConflict {
  return {
    contactId,
    googleResourceName: 'people/c123',
    fieldPath: 'phones[0].value',
    baseValueJson: '"555-0000"',
    googleValueJson: '"555-9999"',
    localValueJson: '"555-1111"',
    detectedAt: new Date().toISOString(),
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConflictRepo', () => {
  // a. insertPending then listPending returns the row
  test('insertPending → listPending returns the row', async () => {
    const db = await fresh(`conflict-repo-a-${ulid()}`)
    const contactId = ulid()
    await seedContact(db, contactId)
    const repo = new ConflictRepo(db)

    await repo.insertPending([makeConflict(contactId)])
    const rows = await repo.listPending()

    expect(rows).toHaveLength(1)
    expect(rows[0]!.contactId).toBe(contactId)
    expect(rows[0]!.status).toBe('pending')
    expect(rows[0]!.resolution).toBeNull()
    await db.close()
  })

  // b. count('pending') returns correct count
  test('count returns correct pending count', async () => {
    const db = await fresh(`conflict-repo-b-${ulid()}`)
    const contactId = ulid()
    await seedContact(db, contactId)
    const repo = new ConflictRepo(db)

    expect(await repo.count('pending')).toBe(0)
    await repo.insertPending([
      makeConflict(contactId, { fieldPath: 'phones[0].value' }),
      makeConflict(contactId, { fieldPath: 'emails[0].value' }),
    ])
    expect(await repo.count('pending')).toBe(2)
    expect(await repo.count('resolved')).toBe(0)
    await db.close()
  })

  // c. resolve(id, 'local') → status changes, listPending=0, listResolved=1
  test('resolve with local → moves from pending to resolved', async () => {
    const db = await fresh(`conflict-repo-c-${ulid()}`)
    const contactId = ulid()
    await seedContact(db, contactId)
    const repo = new ConflictRepo(db)

    await repo.insertPending([makeConflict(contactId)])
    const [row] = await repo.listPending()
    expect(row).toBeDefined()

    await repo.resolve(row!.id, 'local')

    expect(await repo.listPending()).toHaveLength(0)
    const resolved = await repo.listResolved()
    expect(resolved).toHaveLength(1)
    expect(resolved[0]!.resolution).toBe('local')
    expect(resolved[0]!.status).toBe('resolved')
    expect(resolved[0]!.resolvedAt).not.toBeNull()
    await db.close()
  })

  // d. resolve(id, 'custom', json) → custom_value_json stored
  test('resolve with custom stores custom_value_json', async () => {
    const db = await fresh(`conflict-repo-d-${ulid()}`)
    const contactId = ulid()
    await seedContact(db, contactId)
    const repo = new ConflictRepo(db)

    await repo.insertPending([makeConflict(contactId)])
    const [row] = await repo.listPending()
    await repo.resolve(row!.id, 'custom', '{"v":"x"}')

    const resolved = await repo.listResolved()
    expect(resolved[0]!.resolution).toBe('custom')
    expect(resolved[0]!.customValueJson).toBe('{"v":"x"}')
    await db.close()
  })

  // e. listPending({ contactId }) filters by contact
  test('listPending({ contactId }) filters correctly', async () => {
    const db = await fresh(`conflict-repo-e-${ulid()}`)
    const idA = ulid()
    const idB = ulid()
    await seedContact(db, idA)
    await seedContact(db, idB)
    const repo = new ConflictRepo(db)

    await repo.insertPending([makeConflict(idA), makeConflict(idB)])

    const forA = await repo.listPending({ contactId: idA })
    expect(forA).toHaveLength(1)
    expect(forA[0]!.contactId).toBe(idA)
    await db.close()
  })

  // f. listPending({ limit: 1 }) honors limit
  test('listPending({ limit }) honors limit', async () => {
    const db = await fresh(`conflict-repo-f-${ulid()}`)
    const contactId = ulid()
    await seedContact(db, contactId)
    const repo = new ConflictRepo(db)

    await repo.insertPending([
      makeConflict(contactId, { fieldPath: 'phones[0].value' }),
      makeConflict(contactId, { fieldPath: 'emails[0].value' }),
      makeConflict(contactId, { fieldPath: 'addresses[0].city' }),
    ])

    const limited = await repo.listPending({ limit: 1 })
    expect(limited).toHaveLength(1)
    await db.close()
  })

  // g. clearAll empties table
  test('clearAll removes all rows', async () => {
    const db = await fresh(`conflict-repo-g-${ulid()}`)
    const contactId = ulid()
    await seedContact(db, contactId)
    const repo = new ConflictRepo(db)

    await repo.insertPending([
      makeConflict(contactId, { fieldPath: 'phones[0].value' }),
      makeConflict(contactId, { fieldPath: 'emails[0].value' }),
    ])
    expect(await repo.count('pending')).toBe(2)

    await repo.clearAll()
    expect(await repo.count('pending')).toBe(0)
    expect(await repo.listPending()).toHaveLength(0)
    await db.close()
  })
})
