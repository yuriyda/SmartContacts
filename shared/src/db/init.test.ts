// @vitest-environment node
import 'fake-indexeddb/auto'
// Tests for device initialization: persists a stable device_id across reopens.
import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from './wa-sqlite-backend'
import { applyMigrations } from './migrations'
import { initDevice, getDeviceId } from './init'

describe('initDevice', () => {
  test('writes a stable device_id and an initial vector_clock entry', async () => {
    const db = await openWaSqliteAdapter('init-test-1')
    await applyMigrations(db)
    await initDevice(db)
    const did = await getDeviceId(db)
    expect(did).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    const vc = await db.select<{ device_id: string; counter: number }>('SELECT * FROM vector_clock')
    expect(vc).toEqual([{ device_id: did, counter: 0 }])
    await db.close()

    // Reopen — device_id must persist.
    const db2 = await openWaSqliteAdapter('init-test-1')
    await applyMigrations(db2)
    await initDevice(db2)
    expect(await getDeviceId(db2)).toBe(did)
    await db2.close()
  })

  test('initDevice is idempotent: multiple calls do not change device_id', async () => {
    const db = await openWaSqliteAdapter('init-test-2')
    await applyMigrations(db)
    await initDevice(db)
    const did1 = await getDeviceId(db)
    await initDevice(db)
    const did2 = await getDeviceId(db)
    expect(did1).toBe(did2)
    const vc = await db.select<{ device_id: string; counter: number }>('SELECT * FROM vector_clock')
    expect(vc).toHaveLength(1)
    await db.close()
  })

  test('getDeviceId throws if initDevice was never called', async () => {
    const db = await openWaSqliteAdapter('init-test-3')
    await applyMigrations(db)
    await expect(getDeviceId(db)).rejects.toThrow(/not initialized/i)
    await db.close()
  })
})
