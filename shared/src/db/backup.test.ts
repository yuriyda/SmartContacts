// Tests for backup.ts: export, replace-import, merge-import, version rejection,
// and ExportOptions.includeHidden filtering behaviour.
// Uses wa-sqlite in-memory via fake-indexeddb to exercise real SQL paths.
// @vitest-environment node
import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from './wa-sqlite-backend'
import { applyMigrations } from './migrations'
import { initDevice, getDeviceId } from './init'
import { makeContactsRepo } from './contactsRepo'
import { makeCustomFieldDefsRepo } from './customFieldDefsRepo'
import { exportBackup, importBackup, type BackupBundle } from './backup'
import { ulid } from '../ulid'
import type { Contact, CustomFieldDef } from '../types'

async function fresh(name: string) {
  const db = await openWaSqliteAdapter(name)
  await applyMigrations(db)
  await initDevice(db)
  return db
}

describe('backup', () => {
  test('export → importBackup(replace) → export round-trip is deep-equal (sans exportedAt)', async () => {
    const db1 = await fresh('backup-rt-1')
    const did = await getDeviceId(db1)
    const repo = makeContactsRepo(db1, did)
    const defs = makeCustomFieldDefsRepo(db1, did)
    await repo.upsert({
      id: ulid(),
      createdAt: '',
      updatedAt: '',
      lamportTs: 0,
      deviceId: did,
      displayName: 'Иван',
      tags: ['friend'],
    } as Contact)
    await defs.upsert({
      id: ulid(),
      name: 'metAt',
      type: 'date',
      createdAt: '',
      updatedAt: '',
      lamportTs: 0,
      deviceId: did,
    } as CustomFieldDef)
    const b1 = await exportBackup(db1)
    await db1.close()

    const db2 = await fresh('backup-rt-2')
    const r = await importBackup(db2, b1, 'replace')
    expect(r.inserted).toBe(1) // one contact (defs counted separately, see below)
    const b2 = await exportBackup(db2)
    // Compare ignoring exportedAt
    const stripTs = (b: BackupBundle) => ({ ...b, exportedAt: '' })
    expect(stripTs(b2)).toEqual(stripTs(b1))
    await db2.close()
  })

  test('importBackup(merge) accepts newer lamport, skips older', async () => {
    const db = await fresh('backup-merge')
    const did = await getDeviceId(db)
    const repo = makeContactsRepo(db, did)
    const c = await repo.upsert({
      id: ulid(),
      createdAt: '',
      updatedAt: '',
      lamportTs: 0,
      deviceId: did,
      displayName: 'A',
    } as Contact)
    // Local lamport now: 1
    const olderBundle: BackupBundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      device_id: did,
      contacts: [{ ...c, displayName: 'A-OLD', lamportTs: 0, deviceId: 'OTHER' }],
      customFieldDefs: [],
      vectorClock: {},
      meta: {},
    }
    const newerBundle: BackupBundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      device_id: did,
      contacts: [{ ...c, displayName: 'A-NEW', lamportTs: 99, deviceId: 'OTHER' }],
      customFieldDefs: [],
      vectorClock: {},
      meta: {},
    }
    const r1 = await importBackup(db, olderBundle, 'merge')
    expect(r1).toEqual({ inserted: 0, updated: 0, skipped: 1 })
    expect((await repo.getById(c.id))?.displayName).toBe('A')

    const r2 = await importBackup(db, newerBundle, 'merge')
    expect(r2).toEqual({ inserted: 0, updated: 1, skipped: 0 })
    expect((await repo.getById(c.id))?.displayName).toBe('A-NEW')
    await db.close()
  })

  test('rejects bundle with version != 1', async () => {
    const db = await fresh('backup-version')
    const bad = { version: 2 } as unknown as BackupBundle
    await expect(importBackup(db, bad, 'merge')).rejects.toThrow(/version/)
    await db.close()
  })

  test('default export excludes hidden contacts', async () => {
    const db = await fresh('backup-hidden-default')
    const did = await getDeviceId(db)
    const repo = makeContactsRepo(db, did)

    await repo.upsert({
      id: ulid(),
      createdAt: '',
      updatedAt: '',
      lamportTs: 0,
      deviceId: did,
      displayName: 'Visible',
      hidden: false,
    } as Contact)
    await repo.upsert({
      id: ulid(),
      createdAt: '',
      updatedAt: '',
      lamportTs: 0,
      deviceId: did,
      displayName: 'HiddenOne',
      hidden: true,
    } as Contact)

    const bundle = await exportBackup(db)
    expect(bundle.contacts.map((c) => c.displayName)).toContain('Visible')
    expect(bundle.contacts.map((c) => c.displayName)).not.toContain('HiddenOne')
    await db.close()
  })

  test('exportBackup({ includeHidden: false }) also excludes hidden contacts', async () => {
    const db = await fresh('backup-hidden-false')
    const did = await getDeviceId(db)
    const repo = makeContactsRepo(db, did)

    await repo.upsert({
      id: ulid(),
      createdAt: '',
      updatedAt: '',
      lamportTs: 0,
      deviceId: did,
      displayName: 'HiddenTwo',
      hidden: true,
    } as Contact)

    const bundle = await exportBackup(db, { includeHidden: false })
    expect(bundle.contacts.map((c) => c.displayName)).not.toContain('HiddenTwo')
    await db.close()
  })

  test('exportBackup({ includeHidden: true }) includes hidden contacts', async () => {
    const db = await fresh('backup-hidden-true')
    const did = await getDeviceId(db)
    const repo = makeContactsRepo(db, did)

    await repo.upsert({
      id: ulid(),
      createdAt: '',
      updatedAt: '',
      lamportTs: 0,
      deviceId: did,
      displayName: 'Visible2',
      hidden: false,
    } as Contact)
    await repo.upsert({
      id: ulid(),
      createdAt: '',
      updatedAt: '',
      lamportTs: 0,
      deviceId: did,
      displayName: 'HiddenThree',
      hidden: true,
    } as Contact)

    const bundle = await exportBackup(db, { includeHidden: true })
    const names = bundle.contacts.map((c) => c.displayName)
    expect(names).toContain('Visible2')
    expect(names).toContain('HiddenThree')
    await db.close()
  })
})
