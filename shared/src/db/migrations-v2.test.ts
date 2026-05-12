// Tests for schema migration v2 (Google Contacts sync tables).
// Verifies: fresh DB applies all v2 tables; re-run is idempotent; upgrade from v1 works.
// Uses the same mock-adapter pattern as migrations.test.ts (no real DB needed).
import { describe, expect, test, beforeEach } from 'vitest'
import { applyMigrations } from './migrations'
import type { DbAdapter } from './adapter'

// Expected v2 table names from spec §4.2.
const V2_TABLES = [
  'google_contact_snapshots',
  'sync_conflicts',
  'google_labels',
  'google_label_memberships',
  'google_contacts_sync_log',
  'pending_google_avatars',
]

// Mock adapter that tracks executed statements and stores schema_version in memory.
function mockAdapter(initialVersion: number | null = null): DbAdapter & {
  executed: string[]
  getVersion: () => number | null
} {
  const executed: string[] = []
  let metaVersion: number | null = initialVersion

  const adapter: DbAdapter & { executed: string[]; getVersion: () => number | null } = {
    executed,
    getVersion: () => metaVersion,
    async select(sql) {
      if (sql.includes("FROM meta WHERE key='schema_version'")) {
        return metaVersion === null ? [] : ([{ value: String(metaVersion) }] as unknown as never[])
      }
      return [] as unknown as never[]
    },
    async execute(sql, params) {
      executed.push(sql.trim().split('\n')[0]!)
      if (
        /INSERT INTO meta \(key, value\) VALUES \('schema_version', \?\)/.test(sql) ||
        /UPDATE meta SET value=\? WHERE key='schema_version'/.test(sql)
      ) {
        const v = params?.[0]
        if (typeof v === 'string' || typeof v === 'number') metaVersion = Number(v)
      }
    },
    async transaction(fn) {
      return fn(adapter)
    },
    async close() {},
  }
  return adapter
}

describe('migrations v2', () => {
  let db: ReturnType<typeof mockAdapter>

  beforeEach(() => {
    db = mockAdapter()
  })

  test('fresh DB: all v2 tables are created', async () => {
    await applyMigrations(db)
    const ddl = db.executed.join('\n')
    for (const table of V2_TABLES) {
      expect(ddl, `expected table ${table} to be created`).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`),
      )
    }
  })

  test('fresh DB: schema_version is set to 2 after migration', async () => {
    await applyMigrations(db)
    const versionRow = await db.select<{ value: string }>(
      "SELECT value FROM meta WHERE key='schema_version'",
    )
    expect(versionRow[0]?.value).toBe('2')
  })

  test('idempotent: re-running applyMigrations does not re-execute DDL', async () => {
    await applyMigrations(db)
    const firstCount = db.executed.length
    await applyMigrations(db)
    // Second call should be a no-op: version is already 2 >= CURRENT_SCHEMA_VERSION.
    expect(db.executed.length).toBe(firstCount)
  })

  test('upgrade from v1: starts with schema_version=1, v2 tables are created and version becomes 2', async () => {
    // Simulate a DB that was already at v1: meta row exists with value '1'.
    const dbV1 = mockAdapter(1)

    await applyMigrations(dbV1)

    // v2 DDL must have been executed.
    const ddl = dbV1.executed.join('\n')
    for (const table of V2_TABLES) {
      expect(ddl, `expected v2 table ${table} to be created in upgrade path`).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`),
      )
    }

    // Version must be updated to 2.
    const versionRow = await dbV1.select<{ value: string }>(
      "SELECT value FROM meta WHERE key='schema_version'",
    )
    expect(versionRow[0]?.value).toBe('2')
  })

  test('upgrade from v1: v1 tables are NOT re-created (only version update + v2 DDL)', async () => {
    const dbV1 = mockAdapter(1)
    await applyMigrations(dbV1)

    // v1 DDL should NOT appear in executed statements (only v2 and the UPDATE meta).
    const ddl = dbV1.executed.join('\n')
    expect(ddl).not.toMatch(/CREATE TABLE IF NOT EXISTS contacts/)
    expect(ddl).not.toMatch(/CREATE TABLE IF NOT EXISTS meta/)
  })

  test('all 6 v2 tables are present (count check)', async () => {
    await applyMigrations(db)
    const ddl = db.executed.join('\n')
    const found = V2_TABLES.filter((t) => ddl.includes(`CREATE TABLE IF NOT EXISTS ${t}`))
    expect(found).toHaveLength(V2_TABLES.length)
  })
})
