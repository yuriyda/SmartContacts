// Tests for schema migration v2 (Google Contacts sync tables).
// Verifies: fresh DB applies all v2 tables; re-run is idempotent; upgrade from v1 works.
// Uses the same mock-adapter pattern as migrations.test.ts (no real DB needed).
import { describe, expect, test, beforeEach } from 'vitest'
import { applyMigrations, CURRENT_SCHEMA_VERSION } from './migrations'
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

  test('fresh DB: schema_version is set to CURRENT_SCHEMA_VERSION after migration', async () => {
    await applyMigrations(db)
    const versionRow = await db.select<{ value: string }>(
      "SELECT value FROM meta WHERE key='schema_version'",
    )
    expect(versionRow[0]?.value).toBe(String(CURRENT_SCHEMA_VERSION))
  })

  test('functionally idempotent: re-running applyMigrations leaves schema_version unchanged', async () => {
    // Self-healing migrations re-execute IF NOT EXISTS DDL on every call.
    // Idempotency is at SQL semantic level (no rows changed), not "skipped".
    await applyMigrations(db)
    const firstVersion = db.getVersion()
    await applyMigrations(db)
    expect(db.getVersion()).toBe(firstVersion)
    expect(db.getVersion()).toBe(CURRENT_SCHEMA_VERSION)
  })

  test('upgrade from v1: starts with schema_version=1, v2 tables are created and version becomes CURRENT', async () => {
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

    // Version must be updated to CURRENT_SCHEMA_VERSION.
    const versionRow = await dbV1.select<{ value: string }>(
      "SELECT value FROM meta WHERE key='schema_version'",
    )
    expect(versionRow[0]?.value).toBe(String(CURRENT_SCHEMA_VERSION))
  })

  test('self-heals: v1 tables ARE re-issued (CREATE IF NOT EXISTS = harmless re-run)', async () => {
    // With self-healing migrations, all DDL re-runs on every boot. This ensures
    // that if any prior migration left the schema in an inconsistent state
    // (e.g. meta updated without DDL committing), the next boot recreates
    // anything missing. Since all statements are CREATE IF NOT EXISTS, this is
    // semantically a no-op for already-present tables.
    const dbV1 = mockAdapter(1)
    await applyMigrations(dbV1)
    const ddl = dbV1.executed.join('\n')
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS contacts/)
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS meta/)
  })

  test('all 6 v2 tables are present (count check)', async () => {
    await applyMigrations(db)
    const ddl = db.executed.join('\n')
    const found = V2_TABLES.filter((t) => ddl.includes(`CREATE TABLE IF NOT EXISTS ${t}`))
    expect(found).toHaveLength(V2_TABLES.length)
  })
})
