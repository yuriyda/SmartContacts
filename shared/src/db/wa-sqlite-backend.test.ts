// @vitest-environment node
// wa-sqlite-backend integration tests.
// Uses @vitest-environment node because the wa-sqlite WASM binary cannot load under jsdom
// (no native fetch / WebAssembly.instantiateStreaming in jsdom). fake-indexeddb is
// imported explicitly here so that IndexedDB is available in the Node.js environment.
//
// Test coverage:
//   T1 - CRUD round-trip via select/execute after running migrations.
//   T2 - Data persists across reopen via IndexedDB snapshot.
//   T3 - applyMigrations recovers when meta table is dropped (T7 carry-forward).

import 'fake-indexeddb/auto'
import { describe, test, expect } from 'vitest'
import { openWaSqliteAdapter } from './wa-sqlite-backend'
import { applyMigrations, CURRENT_SCHEMA_VERSION } from './migrations'
import { ulid } from '../ulid'

describe('wa-sqlite backend', () => {
  test('CRUD via select/execute round-trip', async () => {
    const db = await openWaSqliteAdapter('test-db-crud')
    await applyMigrations(db)

    const id = ulid()
    const now = new Date().toISOString()

    await db.execute(
      `INSERT INTO contacts (id, display_name, created_at, updated_at, lamport_ts, device_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, 'Иван', now, now, 1, 'DEV1'],
    )

    const rows = await db.select<{ id: string; display_name: string }>(
      'SELECT id, display_name FROM contacts WHERE id = ?',
      [id],
    )
    expect(rows[0]).toMatchObject({ id, display_name: 'Иван' })

    await db.execute('UPDATE contacts SET display_name = ? WHERE id = ?', ['Ivan', id])
    const after = await db.select<{ display_name: string }>(
      'SELECT display_name FROM contacts WHERE id = ?',
      [id],
    )
    expect(after[0]?.display_name).toBe('Ivan')

    await db.execute('DELETE FROM contacts WHERE id = ?', [id])
    const empty = await db.select('SELECT id FROM contacts WHERE id = ?', [id])
    expect(empty).toHaveLength(0)

    await db.close()
  }, 30_000)

  test('persists across reopen via IndexedDB snapshot', async () => {
    const db1 = await openWaSqliteAdapter('test-db-persist')
    await applyMigrations(db1)

    const id = ulid()
    const now = new Date().toISOString()

    await db1.execute(
      `INSERT INTO contacts (id, display_name, created_at, updated_at, lamport_ts, device_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, 'Persist', now, now, 1, 'DEV1'],
    )
    await db1.close()

    const db2 = await openWaSqliteAdapter('test-db-persist')
    const rows = await db2.select<{ display_name: string }>(
      'SELECT display_name FROM contacts WHERE id = ?',
      [id],
    )
    expect(rows[0]?.display_name).toBe('Persist')
    await db2.close()
  }, 30_000)

  test('applyMigrations recovers when meta table is missing but other tables exist', async () => {
    const db = await openWaSqliteAdapter('test-db-partial')
    await applyMigrations(db)

    // Simulate corruption: drop meta only — contacts, vector_clock, etc. remain.
    await db.execute('DROP TABLE meta')

    await applyMigrations(db)

    const rows = await db.select<{ value: string }>(
      "SELECT value FROM meta WHERE key='schema_version'",
    )
    expect(rows[0]?.value).toBe(String(CURRENT_SCHEMA_VERSION))

    await db.close()
  }, 30_000)
})
