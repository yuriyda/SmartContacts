// Tests for SQL schema migrations: applies v1 DDL on a fresh DB and is idempotent.
import { describe, expect, test, beforeEach } from 'vitest'
import { applyMigrations, CURRENT_SCHEMA_VERSION } from './migrations'
import type { DbAdapter } from './adapter'

function mockAdapter(): DbAdapter & { executed: string[] } {
  const executed: string[] = []
  let metaVersion: number | null = null
  const adapter: DbAdapter & { executed: string[] } = {
    executed,
    async select(sql) {
      if (sql.includes("FROM meta WHERE key='schema_version'")) {
        return metaVersion === null ? [] : ([{ value: String(metaVersion) }] as unknown as never[])
      }
      return [] as unknown as never[]
    },
    async execute(sql, params) {
      executed.push(sql.trim().split('\n')[0]!)
      // schema_version is written via parameterised binds; first param is the value.
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

describe('migrations', () => {
  let db: ReturnType<typeof mockAdapter>
  beforeEach(() => {
    db = mockAdapter()
  })

  test('applies all DDL on a fresh DB and writes schema_version', async () => {
    await applyMigrations(db)
    const ddl = db.executed.join('\n')
    expect(ddl).toMatch(/CREATE TABLE.*contacts/)
    expect(ddl).toMatch(/CREATE TABLE.*custom_field_defs/)
    expect(ddl).toMatch(/CREATE TABLE.*vector_clock/)
    expect(ddl).toMatch(/CREATE TABLE.*avatars/)
    expect(ddl).toMatch(/CREATE TABLE.*meta/)
    expect(ddl).toMatch(/CREATE TABLE.*sync_log/)
    const versionRow = await db.select<{ value: string }>(
      "SELECT value FROM meta WHERE key='schema_version'",
    )
    expect(versionRow[0]?.value).toBe(String(CURRENT_SCHEMA_VERSION))
  })

  test('v3 DDL includes google_birthdays and google_relations ALTER TABLE', async () => {
    await applyMigrations(db)
    const ddl = db.executed.join('\n')
    expect(ddl).toContain('google_birthdays')
    expect(ddl).toContain('google_relations')
  })

  test('is functionally idempotent: schema_version unchanged after second call', async () => {
    // Self-healing migrations re-run all CREATE IF NOT EXISTS DDL every boot.
    // Idempotency is at the SQL semantic level (no rows changed), not at the
    // "didn't execute the statement" level.
    await applyMigrations(db)
    const firstVersionRow = await db.select<{ value: string }>(
      "SELECT value FROM meta WHERE key='schema_version'",
    )
    await applyMigrations(db)
    const secondVersionRow = await db.select<{ value: string }>(
      "SELECT value FROM meta WHERE key='schema_version'",
    )
    expect(secondVersionRow[0]?.value).toBe(firstVersionRow[0]?.value)
    expect(secondVersionRow[0]?.value).toBe(String(CURRENT_SCHEMA_VERSION))
  })

  test('upgrade from v2: v3 DDL is applied (re-runs all DDL but idempotently)', async () => {
    // Simulate a DB already at v2: with self-healing migrations we re-run all
    // CREATE IF NOT EXISTS statements, including v3 PRAGMA-guarded ALTERs.
    const v2db = mockAdapter()
    let metaVersion = 2
    const origSelect = v2db.select.bind(v2db)
    v2db.select = async (sql: string) => {
      if (sql.includes("FROM meta WHERE key='schema_version'")) {
        return [{ value: String(metaVersion) }] as unknown as never[]
      }
      return origSelect(sql)
    }
    v2db.execute = async (sql: string, params?: unknown[]) => {
      v2db.executed.push(sql.trim().split('\n')[0]!)
      if (/UPDATE meta SET value=\? WHERE key='schema_version'/.test(sql)) {
        const v = params?.[0]
        if (typeof v === 'string' || typeof v === 'number') metaVersion = Number(v)
      }
    }

    await applyMigrations(v2db)
    const ddl = v2db.executed.join('\n')
    // v3 DDL must be present
    expect(ddl).toContain('google_birthdays')
    expect(ddl).toContain('google_relations')
    // version updated to 3
    const versionRow = await v2db.select<{ value: string }>(
      "SELECT value FROM meta WHERE key='schema_version'",
    )
    expect(versionRow[0]?.value).toBe('3')
  })

  test('self-heals missing tables: re-runs DDL even when schema_version is already current', async () => {
    // First boot: schema gets created.
    await applyMigrations(db)
    const firstCount = db.executed.length
    expect(firstCount).toBeGreaterThan(0)
    // Second boot: DDL is re-run (key property of self-healing migration).
    // The previous behavior short-circuited; with self-healing this number grows.
    await applyMigrations(db)
    expect(db.executed.length).toBeGreaterThan(firstCount)
  })
})
