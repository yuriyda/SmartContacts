// @vitest-environment node
// Tests for factory.ts — makeGoogleSyncRuntime integration wiring.
// Uses real wa-sqlite in-memory database per test (same pattern as snapshot-repo.test.ts).
//
// WHAT IS TESTED:
//  - isConnected() returns false when no token stored.
//  - isConnected() returns true after tokenStore.write().
//  - getPendingConflictCount() returns 0 initially.
//  - disconnect({deleteImported: false}): clears tokenStore + sync tables, keeps contacts.
//  - disconnect({deleteImported: true}): same + deletes Google-imported contacts.
//  - connect() is NOT tested here (requires real OAuth flow; covered by tauri-loopback.test.ts).
//
// Rules:
//  - Each test uses a unique DB name to prevent state leakage.
//  - No `any` types.
//  - All comments in English.

import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { openWaSqliteAdapter } from '../../db/wa-sqlite-backend'
import { applyMigrations } from '../../db/migrations'
import { makeGoogleSyncRuntime } from './factory'
import type { TokenStore } from './oauth/token-store-tauri'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an isolated in-memory DB with all migrations applied. */
async function freshDb(name: string) {
  const db = await openWaSqliteAdapter(name)
  await applyMigrations(db)
  return db
}

/** Create a simple in-memory TokenStore for testing. */
function makeMemoryTokenStore(): TokenStore {
  let stored: string | null = null
  return {
    read: async () => stored,
    write: async (t: string) => {
      stored = t
    },
    clear: async () => {
      stored = null
    },
  }
}

/** Minimal no-op stubs for OAuth host functions. */
const noopInvoke = async (_cmd: string, _args: Record<string, unknown>): Promise<unknown> => null
const noopOpenUrl = async (_url: string): Promise<void> => {}

// ---------------------------------------------------------------------------
// isConnected
// ---------------------------------------------------------------------------

describe('isConnected', () => {
  it('returns false when no token stored', async () => {
    const db = await freshDb('factory-test-isconnected-1')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    expect(await runtime.isConnected()).toBe(false)
    await db.close()
  })

  it('returns true after tokenStore.write()', async () => {
    const db = await freshDb('factory-test-isconnected-2')
    const tokenStore = makeMemoryTokenStore()
    await tokenStore.write('refresh-x')
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    expect(await runtime.isConnected()).toBe(true)
    await db.close()
  })
})

// ---------------------------------------------------------------------------
// getPendingConflictCount
// ---------------------------------------------------------------------------

describe('getPendingConflictCount', () => {
  it('returns 0 initially', async () => {
    const db = await freshDb('factory-test-conflictcount-1')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    expect(await runtime.getPendingConflictCount()).toBe(0)
    await db.close()
  })
})

// ---------------------------------------------------------------------------
// getLastSyncInfo
// ---------------------------------------------------------------------------

describe('getLastSyncInfo', () => {
  it('returns null when no apply_complete event logged', async () => {
    const db = await freshDb('factory-test-lastsync-1')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    expect(await runtime.getLastSyncInfo()).toBeNull()
    await db.close()
  })
})

// ---------------------------------------------------------------------------
// disconnect({deleteImported: false})
// ---------------------------------------------------------------------------

describe('disconnect({deleteImported: false})', () => {
  it('clears tokenStore', async () => {
    const db = await freshDb('factory-test-disconnect-false-1')
    const tokenStore = makeMemoryTokenStore()
    await tokenStore.write('refresh-token')
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    await runtime.disconnect({ deleteImported: false })
    expect(await tokenStore.read()).toBeNull()
    await db.close()
  })

  it('does NOT delete contacts rows', async () => {
    const db = await freshDb('factory-test-disconnect-false-2')
    const tokenStore = makeMemoryTokenStore()

    // Insert a Google-imported contact
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO contacts (id, display_name, google_resource_name, google_etag, created_at, updated_at, lamport_ts, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        '01HZFAKEULID00000000000010',
        'Google Person',
        'people/c-gc-1',
        'etag1',
        now,
        now,
        0,
        'google_sync',
      ],
    )

    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    await runtime.disconnect({ deleteImported: false })

    const rows = await db.select<{ id: string; google_resource_name: string | null }>(
      'SELECT id, google_resource_name FROM contacts',
    )
    expect(rows).toHaveLength(1)
    // google_resource_name should be cleared (set to NULL)
    expect(rows[0]?.google_resource_name).toBeNull()
    await db.close()
  })

  it('clears sync tables', async () => {
    const db = await freshDb('factory-test-disconnect-false-3')
    const tokenStore = makeMemoryTokenStore()

    // Insert a snapshot row
    await db.execute(
      `INSERT INTO google_contact_snapshots (google_resource_name, etag, update_time, payload_json, last_synced_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['people/c-snap', 'etag-snap', '', '{}', new Date().toISOString()],
    )

    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    await runtime.disconnect({ deleteImported: false })

    const snapshots = await db.select('SELECT * FROM google_contact_snapshots')
    expect(snapshots).toHaveLength(0)
    await db.close()
  })

  it('appends oauth_disconnected log entry', async () => {
    const db = await freshDb('factory-test-disconnect-false-4')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    await runtime.disconnect({ deleteImported: false })

    const logs = await db.select<{ event: string; payload_json: string }>(
      `SELECT event, payload_json FROM google_contacts_sync_log WHERE event = 'oauth_disconnected'`,
    )
    expect(logs).toHaveLength(1)
    const payload = JSON.parse(logs[0]!.payload_json) as { deleteImported: boolean }
    expect(payload.deleteImported).toBe(false)
    await db.close()
  })
})

// ---------------------------------------------------------------------------
// disconnect({deleteImported: true})
// ---------------------------------------------------------------------------

describe('disconnect({deleteImported: true})', () => {
  it('deletes Google-imported contacts', async () => {
    const db = await freshDb('factory-test-disconnect-true-1')
    const tokenStore = makeMemoryTokenStore()

    const now = new Date().toISOString()
    // Insert one Google contact and one local contact
    await db.execute(
      `INSERT INTO contacts (id, display_name, google_resource_name, google_etag, created_at, updated_at, lamport_ts, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        '01HZFAKEULID00000000000020',
        'Google Person',
        'people/c-gc-2',
        'etag2',
        now,
        now,
        0,
        'google_sync',
      ],
    )
    await db.execute(
      `INSERT INTO contacts (id, display_name, google_resource_name, created_at, updated_at, lamport_ts, device_id)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      ['01HZFAKEULID00000000000021', 'Local Person', now, now, 0, 'device-local'],
    )

    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    await runtime.disconnect({ deleteImported: true })

    const rows = await db.select<{ id: string }>('SELECT id FROM contacts')
    // Only local contact should remain
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('01HZFAKEULID00000000000021')
    await db.close()
  })

  it('clears tokenStore', async () => {
    const db = await freshDb('factory-test-disconnect-true-2')
    const tokenStore = makeMemoryTokenStore()
    await tokenStore.write('refresh-token')
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    await runtime.disconnect({ deleteImported: true })
    expect(await tokenStore.read()).toBeNull()
    await db.close()
  })

  it('clears sync tables and appends log with deleteImported=true', async () => {
    const db = await freshDb('factory-test-disconnect-true-3')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    await runtime.disconnect({ deleteImported: true })

    const logs = await db.select<{ payload_json: string }>(
      `SELECT payload_json FROM google_contacts_sync_log WHERE event = 'oauth_disconnected'`,
    )
    expect(logs).toHaveLength(1)
    const payload = JSON.parse(logs[0]!.payload_json) as { deleteImported: boolean }
    expect(payload.deleteImported).toBe(true)
    await db.close()
  })
})

// ---------------------------------------------------------------------------
// repos property
// ---------------------------------------------------------------------------

describe('repos', () => {
  it('exposes snapshot, conflict, label, syncLog repos', async () => {
    const db = await freshDb('factory-test-repos-1')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    expect(runtime.repos.snapshot).toBeDefined()
    expect(runtime.repos.conflict).toBeDefined()
    expect(runtime.repos.label).toBeDefined()
    expect(runtime.repos.syncLog).toBeDefined()
    await db.close()
  })
})

// ---------------------------------------------------------------------------
// clientIdStore
// ---------------------------------------------------------------------------

describe('clientIdStore', () => {
  it('is exposed on the runtime', async () => {
    const db = await freshDb('factory-test-clientid-1')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    expect(runtime.clientIdStore).toBeDefined()
    await db.close()
  })

  it('get() returns null before any set()', async () => {
    const db = await freshDb('factory-test-clientid-2')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    expect(await runtime.clientIdStore.get()).toBeNull()
    await db.close()
  })

  it('set() persists value readable via get()', async () => {
    const db = await freshDb('factory-test-clientid-3')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    await runtime.clientIdStore.set('my-client-id.apps.googleusercontent.com')
    expect(await runtime.clientIdStore.get()).toBe('my-client-id.apps.googleusercontent.com')
    await db.close()
  })
})

// ---------------------------------------------------------------------------
// connect() — NO_CLIENT_ID guard
// ---------------------------------------------------------------------------

describe('connect() NO_CLIENT_ID guard', () => {
  it('throws NO_CLIENT_ID when client_id not set', async () => {
    const db = await freshDb('factory-test-connect-noclientid-1')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    // No clientId set in meta table
    await expect(runtime.connect()).rejects.toThrow('NO_CLIENT_ID')
    await db.close()
  })
})
