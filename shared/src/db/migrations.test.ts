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

  test('is idempotent: second call does not re-run DDL', async () => {
    await applyMigrations(db)
    const firstCount = db.executed.length
    await applyMigrations(db)
    expect(db.executed.length).toBe(firstCount)
  })
})
