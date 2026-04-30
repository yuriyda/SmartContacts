// @vitest-environment node
// Tests for customFieldDefsRepo — CRUD, discriminated-union decoding, validation, soft-delete.
// Uses a real wa-sqlite in-memory database per test to verify end-to-end SQL behavior.
// Rules:
//  - Each test creates its own isolated DB (unique name) to avoid state leakage.
//  - fake-indexeddb/auto must be imported before openWaSqliteAdapter to provide IndexedDB in Node.
//  - Do NOT mock DbAdapter — test against the real wa-sqlite backend.
import 'fake-indexeddb/auto'

import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from './wa-sqlite-backend'
import { applyMigrations } from './migrations'
import { makeCustomFieldDefsRepo } from './customFieldDefsRepo'
import { ulid } from '../ulid'
import type { CustomFieldDef } from '../types'

async function fresh(name: string) {
  const db = await openWaSqliteAdapter(name)
  await applyMigrations(db)
  return db
}

function newDef(over: Partial<CustomFieldDef>): CustomFieldDef {
  const base = {
    id: ulid(),
    name: 'X',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lamportTs: 0,
    deviceId: 'DEV',
  }
  return { ...base, type: 'text', ...over } as CustomFieldDef
}

describe('customFieldDefsRepo', () => {
  test('upsert text def + list + getById', async () => {
    const db = await fresh('cfd-1')
    const repo = makeCustomFieldDefsRepo(db, 'DEV')
    const d = await repo.upsert(newDef({ name: 'metAt', type: 'date' }))
    expect(d.type).toBe('date')
    expect(d.lamportTs).toBe(1)
    expect((await repo.list()).length).toBe(1)
    expect((await repo.getById(d.id))?.name).toBe('metAt')
    await db.close()
  })

  test('select def requires non-empty options', async () => {
    const db = await fresh('cfd-2')
    const repo = makeCustomFieldDefsRepo(db, 'DEV')
    await expect(repo.upsert(newDef({ type: 'select' } as never))).rejects.toThrow(/options/)
    const ok = await repo.upsert(newDef({ type: 'select', options: ['a', 'b'] } as never))
    expect((ok as never as { options: string[] }).options).toEqual(['a', 'b'])
    await db.close()
  })

  test('options ignored for non-select types', async () => {
    const db = await fresh('cfd-3')
    const repo = makeCustomFieldDefsRepo(db, 'DEV')
    const d = await repo.upsert(newDef({ type: 'text', options: ['ignored'] } as never))
    // After round-trip, scalar def has no options field (discriminated union)
    expect((d as unknown as Record<string, unknown>).options).toBeUndefined()
    await db.close()
  })

  test('softDelete hides from list, getById still finds', async () => {
    const db = await fresh('cfd-4')
    const repo = makeCustomFieldDefsRepo(db, 'DEV')
    const d = await repo.upsert(newDef({ name: 'gone' }))
    await repo.softDelete(d.id)
    expect((await repo.list()).length).toBe(0)
    expect((await repo.getById(d.id))?.deletedAt).toBeTruthy()
    await db.close()
  })

  test('rejects unknown type', async () => {
    const db = await fresh('cfd-5')
    const repo = makeCustomFieldDefsRepo(db, 'DEV')
    await expect(repo.upsert(newDef({ type: 'bogus' as never }))).rejects.toThrow(/type/i)
    await db.close()
  })
})
