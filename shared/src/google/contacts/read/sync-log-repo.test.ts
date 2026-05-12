// @vitest-environment node
// Tests for SyncLogRepo — CRUD operations on google_contacts_sync_log.
// Uses a real wa-sqlite in-memory database per test to verify end-to-end SQL behavior.
// RO-INVARIANT: INV-1 (separate audit log for Google Contacts pull), L2.3 (audit).
//
// Rules:
//  - Each test creates its own isolated DB (unique name) to avoid state leakage.
//  - fake-indexeddb/auto must be imported before openWaSqliteAdapter.
//  - Do NOT mock DbAdapter — test against the real wa-sqlite backend.

import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from '../../../db/wa-sqlite-backend'
import { applyMigrations } from '../../../db/migrations'
import { SyncLogRepo } from './sync-log-repo'

// ---------------------------------------------------------------------------
// Helper: fresh isolated DB
// ---------------------------------------------------------------------------

async function fresh(name: string) {
  const db = await openWaSqliteAdapter(name)
  await applyMigrations(db)
  return db
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncLogRepo', () => {
  // Case a: append + listByRun returns inserted row, ordered.
  test('append + listByRun returns inserted rows ordered by ts ASC', async () => {
    const db = await fresh('sync-log-repo-a')
    const repo = new SyncLogRepo(db)

    await repo.append({ runId: 'run-1', event: 'fetch_page' })
    await repo.append({ runId: 'run-1', event: 'apply_complete' })

    const rows = await repo.listByRun('run-1')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.event).toBe('fetch_page')
    expect(rows[1]!.event).toBe('apply_complete')
    expect(rows[0]!.runId).toBe('run-1')
    expect(rows[0]!.level).toBe('info')
    expect(typeof rows[0]!.id).toBe('number')
    expect(typeof rows[0]!.ts).toBe('string')

    await db.close()
  })

  // Case b: payload object → payloadJson is JSON.stringify of it.
  test('payload object is serialized to payloadJson', async () => {
    const db = await fresh('sync-log-repo-b')
    const repo = new SyncLogRepo(db)
    const payload = { count: 42, label: 'test' }

    await repo.append({ runId: 'run-2', event: 'http_call', payload })

    const rows = await repo.listByRun('run-2')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payloadJson).toBe(JSON.stringify(payload))

    await db.close()
  })

  // Case c: payload undefined → payloadJson is JSON-null "null".
  test('undefined payload serializes to JSON null string', async () => {
    const db = await fresh('sync-log-repo-c')
    const repo = new SyncLogRepo(db)

    await repo.append({ runId: 'run-3', event: 'error', level: 'error' })

    const rows = await repo.listByRun('run-3')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payloadJson).toBe('null')

    await db.close()
  })

  // Case d: listLatest('http_call', 5) returns 5 most recent http_call events in DESC order.
  test('listLatest returns N most recent events in DESC order', async () => {
    const db = await fresh('sync-log-repo-d')
    const repo = new SyncLogRepo(db)

    // Insert 7 http_call events plus 2 of another type.
    for (let i = 0; i < 7; i++) {
      await repo.append({ runId: `run-${i}`, event: 'http_call', payload: { seq: i } })
    }
    await repo.append({ runId: 'run-x', event: 'fetch_page' })
    await repo.append({ runId: 'run-y', event: 'fetch_page' })

    const rows = await repo.listLatest('http_call', 5)
    expect(rows).toHaveLength(5)
    // Verify DESC order (ts of row[0] >= row[1] etc.)
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i]!.ts >= rows[i + 1]!.ts).toBe(true)
    }
    // All returned rows must be http_call
    expect(rows.every((r) => r.event === 'http_call')).toBe(true)

    await db.close()
  })

  // Case e: latestConsentTs returns ts of the latest oauth_consent (null if none).
  test('latestConsentTs returns ts of latest oauth_consent, null if none', async () => {
    const db = await fresh('sync-log-repo-e')
    const repo = new SyncLogRepo(db)

    // No events yet — should return null.
    const nullResult = await repo.latestConsentTs()
    expect(nullResult).toBe(null)

    // Insert two consent events.
    await repo.append({ runId: 'run-1', event: 'oauth_consent' })
    await repo.append({ runId: 'run-2', event: 'oauth_consent' })
    // Insert other events to verify filtering.
    await repo.append({ runId: 'run-3', event: 'http_call' })

    const ts = await repo.latestConsentTs()
    expect(ts).not.toBe(null)
    expect(typeof ts).toBe('string')

    // The returned ts must belong to a real row.
    const rows = await repo.listLatest('oauth_consent', 10)
    expect(rows.some((r) => r.ts === ts)).toBe(true)

    await db.close()
  })

  // Case f: clear empties the table.
  test('clear deletes all rows', async () => {
    const db = await fresh('sync-log-repo-f')
    const repo = new SyncLogRepo(db)

    await repo.append({ runId: 'run-1', event: 'fetch_page' })
    await repo.append({ runId: 'run-2', event: 'apply_complete' })
    await repo.append({ runId: 'run-3', event: 'error', level: 'error' })

    await repo.clear()

    const rows = await repo.listByRun('run-1')
    expect(rows).toHaveLength(0)

    const consent = await repo.latestConsentTs()
    expect(consent).toBe(null)

    await db.close()
  })
})
