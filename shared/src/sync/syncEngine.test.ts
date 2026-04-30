// @vitest-environment node
// syncEngine.test.ts — Integration tests for the syncEngine orchestrator.
// Tests cover: OAuthNotConfiguredError propagation, two-device convergence via
// in-memory bundle, stats reflection, fresh-device byte counts, and malformed
// remote bundle handling.
//
// Rules:
//  - Each test uses fresh in-memory wa-sqlite DBs with unique names.
//  - fake-indexeddb provides the IndexedDB implementation used by wa-sqlite.
//  - DriveAppdataClient is mocked via an in-memory variable (no real HTTP).
//  - Do NOT import from node:* directly; use vitest helpers.

import 'fake-indexeddb/auto'

import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from '../db/wa-sqlite-backend'
import { applyMigrations } from '../db/migrations'
import { initDevice, getDeviceId } from '../db/init'
import { makeContactsRepo } from '../db/contactsRepo'
import { makeStubAccessTokenSource, OAuthNotConfiguredError } from '../google/oauth'
import type { DriveAppdataClient } from '../google/driveAppdata'
import type { AccessTokenSource } from '../google/oauth'
import { syncOnce } from './syncEngine'
import type { SyncEngineDeps } from './syncEngine'
import { ulid } from '../ulid'
import type { Contact } from '../types'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function freshDb(name: string) {
  const db = await openWaSqliteAdapter(name)
  await applyMigrations(db)
  await initDevice(db)
  return db
}

function newContact(over: Partial<Contact> = {}): Contact {
  return {
    id: ulid(),
    createdAt: '',
    updatedAt: '',
    lamportTs: 0,
    deviceId: '',
    ...over,
  }
}

/**
 * Builds a fake DriveAppdataClient backed by a single in-memory bundle variable.
 * The bundle starts as null (no file on Drive). uploadBundle stores whatever is
 * passed; downloadBundle returns it. findSyncFileId returns a stub id when a
 * bundle exists, null otherwise.
 */
function makeInMemoryDriveClient(initial?: object | null): {
  client: DriveAppdataClient
  getBundle: () => object | null
  setBundle: (b: object | null) => void
} {
  let bundle: object | null = initial ?? null
  const STUB_FILE_ID = 'fake-file-id-001'

  const client: DriveAppdataClient = {
    async findSyncFileId(_token: string, _fileName: string): Promise<string | null> {
      return bundle !== null ? STUB_FILE_ID : null
    },
    async uploadBundle(_token: string, _fileName: string, b: object): Promise<string> {
      bundle = b
      return STUB_FILE_ID
    },
    async downloadBundle(_token: string, _fileId: string): Promise<unknown> {
      return bundle
    },
  }

  return {
    client,
    getBundle: () => bundle,
    setBundle: (b) => {
      bundle = b
    },
  }
}

/** Fake token source that returns a fixed token string without network. */
function makeFakeTokenSource(token = 'fake-token'): AccessTokenSource {
  return {
    async getAccessToken(): Promise<string> {
      return token
    },
  }
}

// ---------------------------------------------------------------------------
// Test 1: Throws when OAuth not configured
// ---------------------------------------------------------------------------

describe('syncOnce', () => {
  test('throws OAuthNotConfiguredError when token source is the stub', async () => {
    const db = await freshDb('engine-oauth-test')
    const { client } = makeInMemoryDriveClient()
    const deps: SyncEngineDeps = {
      db,
      drive: client,
      tokenSource: makeStubAccessTokenSource(),
    }

    await expect(syncOnce(deps)).rejects.toThrow(OAuthNotConfiguredError)

    await db.close()
  })

  // -------------------------------------------------------------------------
  // Test 4: Returns 0 downloadedBytes when no remote file exists (fresh device)
  // -------------------------------------------------------------------------

  test('returns 0 downloadedBytes and positive uploadedBytes on first sync (no remote)', async () => {
    const db = await freshDb('engine-fresh-device')
    const deviceId = await getDeviceId(db)
    const repo = makeContactsRepo(db, deviceId)
    await repo.upsert(newContact({ displayName: 'Local Contact' }))

    const { client } = makeInMemoryDriveClient(null) // no file on Drive
    const deps: SyncEngineDeps = {
      db,
      drive: client,
      tokenSource: makeFakeTokenSource(),
    }

    const result = await syncOnce(deps)

    expect(result.downloadedBytes).toBe(0)
    expect(result.uploadedBytes).toBeGreaterThan(0)
    expect(result.stats.applied).toBe(0)
    expect(result.stats.skipped).toBe(0)
    expect(result.stats.outdated).toBe(0)

    await db.close()
  })

  // -------------------------------------------------------------------------
  // Test 5: Ignores malformed remote bundle — no throw, no import, uploads local
  // -------------------------------------------------------------------------

  test('ignores malformed remote bundle without throwing and still uploads local snapshot', async () => {
    const db = await freshDb('engine-malformed')
    const deviceId = await getDeviceId(db)
    const repo = makeContactsRepo(db, deviceId)
    await repo.upsert(newContact({ displayName: 'Pre-existing' }))

    // Prime with garbage that is NOT a SyncPackage
    const { client } = makeInMemoryDriveClient({ foo: 'bar' })
    const deps: SyncEngineDeps = {
      db,
      drive: client,
      tokenSource: makeFakeTokenSource(),
    }

    // Should NOT throw
    const result = await syncOnce(deps)

    // No import happened (malformed bundle ignored)
    expect(result.stats.applied).toBe(0)
    expect(result.stats.skipped).toBe(0)
    expect(result.stats.outdated).toBe(0)
    // But did upload local snapshot
    expect(result.uploadedBytes).toBeGreaterThan(0)

    await db.close()
  })

  // -------------------------------------------------------------------------
  // Test 2+3: Two-device convergence via in-memory bundle + stats check
  // -------------------------------------------------------------------------

  test('two devices converge via shared in-memory Drive bundle', async () => {
    const dbA = await freshDb('engine-conv-a')
    const dbB = await freshDb('engine-conv-b')
    const didA = await getDeviceId(dbA)
    const didB = await getDeviceId(dbB)
    const repoA = makeContactsRepo(dbA, didA)
    const repoB = makeContactsRepo(dbB, didB)

    // Insert different contacts on each device
    await repoA.upsert(newContact({ displayName: 'Alice (device A)' }))
    await repoB.upsert(newContact({ displayName: 'Bob (device B)' }))

    // Both devices share the same fake Drive storage
    const { client: sharedDrive } = makeInMemoryDriveClient(null)
    const tokenSource = makeFakeTokenSource()

    const depsA: SyncEngineDeps = { db: dbA, drive: sharedDrive, tokenSource }
    const depsB: SyncEngineDeps = { db: dbB, drive: sharedDrive, tokenSource }

    // Round 1: Device A syncs — uploads its snapshot (no remote exists yet)
    await syncOnce(depsA)

    // Round 2: Device B syncs — downloads A's bundle, merges, uploads A∪B
    const resultB = await syncOnce(depsB)

    // B applied at least A's contact (applied >= 1)
    expect(resultB.stats.applied).toBeGreaterThanOrEqual(1)

    // Round 3: Device A syncs again — downloads B's merged bundle, applies B's contact
    await syncOnce(depsA)

    // Both devices should now have Alice and Bob
    const aList = await repoA.list({})
    const bList = await repoB.list({})

    expect(aList.length).toBe(2)
    expect(bList.length).toBe(2)

    const aIds = new Set(aList.map((c) => c.id))
    const bIds = new Set(bList.map((c) => c.id))
    for (const id of aIds) {
      expect(bIds.has(id)).toBe(true)
    }

    await dbA.close()
    await dbB.close()
  })
})
