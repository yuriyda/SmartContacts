// @vitest-environment node
// Tests for SnapshotRepo — CRUD operations on google_contact_snapshots.
// Uses a real wa-sqlite in-memory database per test to verify end-to-end SQL behavior.
// RO-INVARIANT: INV-3 (snapshot as three-way merge base).
//
// Rules:
//  - Each test creates its own isolated DB (unique name) to avoid state leakage.
//  - fake-indexeddb/auto must be imported before openWaSqliteAdapter to provide IndexedDB in Node.
//  - Do NOT mock DbAdapter — test against the real wa-sqlite backend.

import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from '../../../db/wa-sqlite-backend'
import { applyMigrations } from '../../../db/migrations'
import { SnapshotRepo } from './snapshot-repo'
import type { Snapshot } from './snapshot-repo'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fresh(name: string) {
  const db = await openWaSqliteAdapter(name)
  await applyMigrations(db)
  return db
}

function makeSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    googleResourceName: 'people/c123',
    etag: 'abc123etag',
    updateTime: '2026-05-10T10:00:00Z',
    payloadJson: '{"name":"Test"}',
    lastSyncedAt: '2026-05-10T10:00:00Z',
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SnapshotRepo', () => {
  test('get on empty table returns null', async () => {
    const db = await fresh('snapshot-repo-1')
    const repo = new SnapshotRepo(db)
    const result = await repo.get('people/nonexistent')
    expect(result).toBe(null)
    await db.close()
  })

  test('upsert + get round-trip preserves all 5 fields', async () => {
    const db = await fresh('snapshot-repo-2')
    const repo = new SnapshotRepo(db)
    const snap = makeSnapshot()
    await repo.upsert(snap)
    const result = await repo.get(snap.googleResourceName)
    expect(result).not.toBe(null)
    expect(result?.googleResourceName).toBe(snap.googleResourceName)
    expect(result?.etag).toBe(snap.etag)
    expect(result?.updateTime).toBe(snap.updateTime)
    expect(result?.payloadJson).toBe(snap.payloadJson)
    expect(result?.lastSyncedAt).toBe(snap.lastSyncedAt)
    await db.close()
  })

  test('upsert of same key replaces the row', async () => {
    const db = await fresh('snapshot-repo-3')
    const repo = new SnapshotRepo(db)
    const snap = makeSnapshot({ etag: 'original-etag' })
    await repo.upsert(snap)
    const updated = makeSnapshot({ etag: 'updated-etag', payloadJson: '{"name":"Updated"}' })
    await repo.upsert(updated)
    const result = await repo.get(snap.googleResourceName)
    expect(result?.etag).toBe('updated-etag')
    expect(result?.payloadJson).toBe('{"name":"Updated"}')
    // Confirm only one row exists
    const all = await repo.listAll()
    expect(all.length).toBe(1)
    await db.close()
  })

  test('deleteByResource removes the row, get returns null', async () => {
    const db = await fresh('snapshot-repo-4')
    const repo = new SnapshotRepo(db)
    const snap = makeSnapshot()
    await repo.upsert(snap)
    await repo.deleteByResource(snap.googleResourceName)
    const result = await repo.get(snap.googleResourceName)
    expect(result).toBe(null)
    await db.close()
  })

  test('listAll returns all rows', async () => {
    const db = await fresh('snapshot-repo-5')
    const repo = new SnapshotRepo(db)
    const snaps = [
      makeSnapshot({ googleResourceName: 'people/c1', etag: 'e1' }),
      makeSnapshot({ googleResourceName: 'people/c2', etag: 'e2' }),
      makeSnapshot({ googleResourceName: 'people/c3', etag: 'e3' }),
    ]
    for (const s of snaps) {
      await repo.upsert(s)
    }
    const all = await repo.listAll()
    expect(all.length).toBe(3)
    const resourceNames = all.map((s) => s.googleResourceName).sort()
    expect(resourceNames).toEqual(['people/c1', 'people/c2', 'people/c3'])
    await db.close()
  })

  test('deleteAll leaves the table empty', async () => {
    const db = await fresh('snapshot-repo-6')
    const repo = new SnapshotRepo(db)
    await repo.upsert(makeSnapshot({ googleResourceName: 'people/c1', etag: 'e1' }))
    await repo.upsert(makeSnapshot({ googleResourceName: 'people/c2', etag: 'e2' }))
    await repo.deleteAll()
    const all = await repo.listAll()
    expect(all.length).toBe(0)
    await db.close()
  })
})
