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
//  - resolveConflict(): all 10 side-effect cases from spec §6.7.
//
// Rules:
//  - Each test uses a unique DB name to prevent state leakage.
//  - No `any` types.
//  - All comments in English.

import 'fake-indexeddb/auto'
import { describe, it, expect, vi } from 'vitest'
import { openWaSqliteAdapter } from '../../db/wa-sqlite-backend'
import { applyMigrations } from '../../db/migrations'
import { makeGoogleSyncRuntime } from './factory'
import type { TokenStore } from './oauth/token-store-tauri'
import { InvalidGrantError } from './oauth/tauri-loopback'

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

// ---------------------------------------------------------------------------
// resolveConflict — side effects (spec §6.7)
// ---------------------------------------------------------------------------

/** Seed a minimal contact + snapshot + pending conflict row for tests. */
async function seedConflict(
  db: Awaited<ReturnType<typeof freshDb>>,
  opts: {
    dbName: string
    contactId: string
    googleResourceName: string
    fieldPath: string
    baseValueJson?: string | null
    googleValueJson?: string | null
    localValueJson: string
    /** Initial contacts row column values (beyond id/google_resource_name). */
    contactExtra?: Record<string, unknown>
    /** Initial snapshot payload (JSON-serializable object). */
    snapshotPayload?: Record<string, unknown>
  },
): Promise<number> {
  const now = new Date().toISOString()
  const extra = opts.contactExtra ?? {}
  const cols = Object.keys(extra)
  const extraCols = cols.length > 0 ? ', ' + cols.join(', ') : ''
  const extraPlaceholders = cols.length > 0 ? ', ' + cols.map(() => '?').join(', ') : ''
  const extraVals = cols.map((c) => extra[c])

  await db.execute(
    `INSERT INTO contacts
       (id, display_name, google_resource_name, google_etag, created_at, updated_at, lamport_ts, device_id${extraCols})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?${extraPlaceholders})`,
    [
      opts.contactId,
      'Test Person',
      opts.googleResourceName,
      'etag-v1',
      now,
      now,
      0,
      'google_sync',
      ...extraVals,
    ],
  )

  const snapshotPayload = opts.snapshotPayload ?? {}
  await db.execute(
    `INSERT INTO google_contact_snapshots (google_resource_name, etag, update_time, payload_json, last_synced_at)
     VALUES (?, ?, ?, ?, ?)`,
    [opts.googleResourceName, 'etag-v1', now, JSON.stringify(snapshotPayload), now],
  )

  await db.execute(
    `INSERT INTO sync_conflicts
       (contact_id, google_resource_name, field_path, base_value_json, google_value_json, local_value_json, status, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      opts.contactId,
      opts.googleResourceName,
      opts.fieldPath,
      opts.baseValueJson ?? null,
      opts.googleValueJson ?? null,
      opts.localValueJson,
      now,
    ],
  )

  const rows = await db.select<{ id: number }>(
    `SELECT id FROM sync_conflicts WHERE contact_id = ? AND field_path = ?`,
    [opts.contactId, opts.fieldPath],
  )
  return rows[0]!.id
}

describe('resolveConflict — side effects', () => {
  // ---------- case (a): 'local' on scalar field ----------
  it('(a) local on notesMd: contacts unchanged, snapshot updated, conflict resolved', async () => {
    const db = await freshDb('factory-rc-a')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })

    const cid = '01RCTEST0000000000000000A0'
    const rn = 'people/rc-a'
    const localNotes = 'My local notes'
    const googleNotes = 'Google notes'

    const conflictId = await seedConflict(db, {
      dbName: 'factory-rc-a',
      contactId: cid,
      googleResourceName: rn,
      fieldPath: 'notesMd',
      baseValueJson: JSON.stringify('old notes'),
      googleValueJson: JSON.stringify(googleNotes),
      localValueJson: JSON.stringify(localNotes),
      contactExtra: { notes_md: localNotes },
      snapshotPayload: { notesMd: 'old notes' },
    })

    await runtime.resolveConflict(conflictId, 'local')

    // contacts row: unchanged
    const contacts = await db.select<{ notes_md: string | null }>(
      'SELECT notes_md FROM contacts WHERE id = ?',
      [cid],
    )
    expect(contacts[0]?.notes_md).toBe(localNotes)

    // snapshot.payload_json.notesMd → local value
    const snaps = await db.select<{ payload_json: string }>(
      'SELECT payload_json FROM google_contact_snapshots WHERE google_resource_name = ?',
      [rn],
    )
    const payload = JSON.parse(snaps[0]!.payload_json) as Record<string, unknown>
    expect(payload['notesMd']).toBe(localNotes)

    // conflict resolved
    const conflicts = await db.select<{ status: string; resolution: string }>(
      'SELECT status, resolution FROM sync_conflicts WHERE id = ?',
      [conflictId],
    )
    expect(conflicts[0]?.status).toBe('resolved')
    expect(conflicts[0]?.resolution).toBe('local')

    await db.close()
  })

  // ---------- case (b): 'google' on scalar field ----------
  it('(b) google on notesMd: contacts updated, snapshot updated, conflict resolved', async () => {
    const db = await freshDb('factory-rc-b')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })

    const cid = '01RCTEST0000000000000000B0'
    const rn = 'people/rc-b'
    const localNotes = 'My local notes'
    const googleNotes = 'Google notes'

    const conflictId = await seedConflict(db, {
      dbName: 'factory-rc-b',
      contactId: cid,
      googleResourceName: rn,
      fieldPath: 'notesMd',
      baseValueJson: JSON.stringify('old notes'),
      googleValueJson: JSON.stringify(googleNotes),
      localValueJson: JSON.stringify(localNotes),
      contactExtra: { notes_md: localNotes },
      snapshotPayload: { notesMd: 'old notes' },
    })

    await runtime.resolveConflict(conflictId, 'google')

    // contacts row updated to Google value
    const contacts = await db.select<{ notes_md: string | null }>(
      'SELECT notes_md FROM contacts WHERE id = ?',
      [cid],
    )
    expect(contacts[0]?.notes_md).toBe(googleNotes)

    // snapshot.payload_json.notesMd → google value
    const snaps = await db.select<{ payload_json: string }>(
      'SELECT payload_json FROM google_contact_snapshots WHERE google_resource_name = ?',
      [rn],
    )
    const payload = JSON.parse(snaps[0]!.payload_json) as Record<string, unknown>
    expect(payload['notesMd']).toBe(googleNotes)

    const conflicts = await db.select<{ status: string; resolution: string }>(
      'SELECT status, resolution FROM sync_conflicts WHERE id = ?',
      [conflictId],
    )
    expect(conflicts[0]?.status).toBe('resolved')
    expect(conflicts[0]?.resolution).toBe('google')

    await db.close()
  })

  // ---------- case (c): 'custom' on scalar field ----------
  it('(c) custom on notesMd: contacts and snapshot updated to custom value', async () => {
    const db = await freshDb('factory-rc-c')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })

    const cid = '01RCTEST0000000000000000C0'
    const rn = 'people/rc-c'
    const customNotes = 'Custom merged notes'

    const conflictId = await seedConflict(db, {
      dbName: 'factory-rc-c',
      contactId: cid,
      googleResourceName: rn,
      fieldPath: 'notesMd',
      baseValueJson: JSON.stringify('old notes'),
      googleValueJson: JSON.stringify('Google notes'),
      localValueJson: JSON.stringify('My local notes'),
      contactExtra: { notes_md: 'My local notes' },
      snapshotPayload: { notesMd: 'old notes' },
    })

    await runtime.resolveConflict(conflictId, 'custom', JSON.stringify(customNotes))

    const contacts = await db.select<{ notes_md: string | null }>(
      'SELECT notes_md FROM contacts WHERE id = ?',
      [cid],
    )
    expect(contacts[0]?.notes_md).toBe(customNotes)

    const snaps = await db.select<{ payload_json: string }>(
      'SELECT payload_json FROM google_contact_snapshots WHERE google_resource_name = ?',
      [rn],
    )
    const payload = JSON.parse(snaps[0]!.payload_json) as Record<string, unknown>
    expect(payload['notesMd']).toBe(customNotes)

    const conflicts = await db.select<{
      status: string
      resolution: string
      custom_value_json: string | null
    }>('SELECT status, resolution, custom_value_json FROM sync_conflicts WHERE id = ?', [
      conflictId,
    ])
    expect(conflicts[0]?.status).toBe('resolved')
    expect(conflicts[0]?.resolution).toBe('custom')
    expect(conflicts[0]?.custom_value_json).toBe(JSON.stringify(customNotes))

    await db.close()
  })

  // ---------- case (d): 'google' on photos[0] ----------
  it('(d) google on photos[0]: pending avatar consumed, avatars written, contacts.avatar_hash updated', async () => {
    const db = await freshDb('factory-rc-d')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })

    const cid = '01RCTEST0000000000000000D0'
    const rn = 'people/rc-d'
    const now = new Date().toISOString()

    const conflictId = await seedConflict(db, {
      dbName: 'factory-rc-d',
      contactId: cid,
      googleResourceName: rn,
      fieldPath: 'photos[0]',
      baseValueJson: JSON.stringify('hash-base'),
      googleValueJson: JSON.stringify('hash-google'),
      localValueJson: JSON.stringify('hash-local'),
      contactExtra: { avatar_hash: 'hash-local' },
      snapshotPayload: { photoContentHash: 'hash-base' },
    })

    // Insert pending_google_avatars row
    const fakeBlob = new Uint8Array([1, 2, 3])
    await db.execute(
      `INSERT INTO pending_google_avatars (contact_id, mime, blob, hash, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
      [cid, 'image/jpeg', fakeBlob, 'hash-google', now],
    )

    await runtime.resolveConflict(conflictId, 'google')

    // pending_google_avatars deleted
    const pending = await db.select('SELECT * FROM pending_google_avatars WHERE contact_id = ?', [
      cid,
    ])
    expect(pending).toHaveLength(0)

    // avatars row written
    const avatars = await db.select<{ hash: string; mime: string }>(
      'SELECT hash, mime FROM avatars WHERE contact_id = ?',
      [cid],
    )
    expect(avatars).toHaveLength(1)
    expect(avatars[0]?.hash).toBe('hash-google')
    expect(avatars[0]?.mime).toBe('image/jpeg')

    // contacts.avatar_hash updated
    const contacts = await db.select<{ avatar_hash: string | null }>(
      'SELECT avatar_hash FROM contacts WHERE id = ?',
      [cid],
    )
    expect(contacts[0]?.avatar_hash).toBe('hash-google')

    // snapshot photoContentHash updated
    const snaps = await db.select<{ payload_json: string }>(
      'SELECT payload_json FROM google_contact_snapshots WHERE google_resource_name = ?',
      [rn],
    )
    const payload = JSON.parse(snaps[0]!.payload_json) as Record<string, unknown>
    expect(payload['photoContentHash']).toBe('hash-google')

    await db.close()
  })

  // ---------- case (e): 'local' on photos[0] ----------
  it('(e) local on photos[0]: pending avatar deleted, avatars/contacts unchanged', async () => {
    const db = await freshDb('factory-rc-e')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })

    const cid = '01RCTEST0000000000000000E0'
    const rn = 'people/rc-e'
    const now = new Date().toISOString()

    const conflictId = await seedConflict(db, {
      dbName: 'factory-rc-e',
      contactId: cid,
      googleResourceName: rn,
      fieldPath: 'photos[0]',
      baseValueJson: JSON.stringify('hash-base'),
      googleValueJson: JSON.stringify('hash-google'),
      localValueJson: JSON.stringify('hash-local'),
      contactExtra: { avatar_hash: 'hash-local' },
      snapshotPayload: { photoContentHash: 'hash-base' },
    })

    await db.execute(
      `INSERT INTO pending_google_avatars (contact_id, mime, blob, hash, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
      [cid, 'image/jpeg', new Uint8Array([4, 5, 6]), 'hash-google', now],
    )

    await runtime.resolveConflict(conflictId, 'local')

    // pending deleted
    const pending = await db.select('SELECT * FROM pending_google_avatars WHERE contact_id = ?', [
      cid,
    ])
    expect(pending).toHaveLength(0)

    // avatars unchanged (no row inserted)
    const avatars = await db.select('SELECT * FROM avatars WHERE contact_id = ?', [cid])
    expect(avatars).toHaveLength(0)

    // contacts.avatar_hash unchanged
    const contacts = await db.select<{ avatar_hash: string | null }>(
      'SELECT avatar_hash FROM contacts WHERE id = ?',
      [cid],
    )
    expect(contacts[0]?.avatar_hash).toBe('hash-local')

    // snapshot photoContentHash advanced to local hash
    const snaps = await db.select<{ payload_json: string }>(
      'SELECT payload_json FROM google_contact_snapshots WHERE google_resource_name = ?',
      [rn],
    )
    const payload = JSON.parse(snaps[0]!.payload_json) as Record<string, unknown>
    expect(payload['photoContentHash']).toBe('hash-local')

    await db.close()
  })

  // ---------- case (f): '__deletion__' + 'google' ----------
  it('(f) __deletion__ + google: contact row deleted', async () => {
    const db = await freshDb('factory-rc-f')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })

    const cid = '01RCTEST0000000000000000F0'
    const rn = 'people/rc-f'

    const conflictId = await seedConflict(db, {
      dbName: 'factory-rc-f',
      contactId: cid,
      googleResourceName: rn,
      fieldPath: '__deletion__',
      baseValueJson: JSON.stringify({}),
      googleValueJson: null,
      localValueJson: JSON.stringify({ googleResourceName: rn }),
      snapshotPayload: {},
    })

    await runtime.resolveConflict(conflictId, 'google')

    // Contact row gone (CASCADE may also remove conflict row)
    const contacts = await db.select('SELECT * FROM contacts WHERE id = ?', [cid])
    expect(contacts).toHaveLength(0)

    // Log event created
    const logs = await db.select<{ payload_json: string }>(
      `SELECT payload_json FROM google_contacts_sync_log WHERE event = 'conflict_resolved'`,
    )
    expect(logs.length).toBeGreaterThan(0)
    const logPayload = JSON.parse(logs[0]!.payload_json) as Record<string, unknown>
    expect(logPayload['field_path']).toBe('__deletion__')

    await db.close()
  })

  // ---------- case (g): '__deletion__' + 'local' ----------
  it('(g) __deletion__ + local: contact kept, google fields nulled, snapshot deleted', async () => {
    const db = await freshDb('factory-rc-g')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })

    const cid = '01RCTEST0000000000000000G0'
    const rn = 'people/rc-g'

    const conflictId = await seedConflict(db, {
      dbName: 'factory-rc-g',
      contactId: cid,
      googleResourceName: rn,
      fieldPath: '__deletion__',
      baseValueJson: JSON.stringify({}),
      googleValueJson: null,
      localValueJson: JSON.stringify({ googleResourceName: rn }),
      snapshotPayload: {},
    })

    await runtime.resolveConflict(conflictId, 'local')

    // Contact row still exists
    const contacts = await db.select<{
      id: string
      google_resource_name: string | null
      google_etag: string | null
    }>('SELECT id, google_resource_name, google_etag FROM contacts WHERE id = ?', [cid])
    expect(contacts).toHaveLength(1)
    expect(contacts[0]?.google_resource_name).toBeNull()
    expect(contacts[0]?.google_etag).toBeNull()

    // Snapshot deleted
    const snaps = await db.select(
      'SELECT * FROM google_contact_snapshots WHERE google_resource_name = ?',
      [rn],
    )
    expect(snaps).toHaveLength(0)

    // Conflict resolved
    const conflicts = await db.select<{ status: string }>(
      'SELECT status FROM sync_conflicts WHERE id = ?',
      [conflictId],
    )
    expect(conflicts[0]?.status).toBe('resolved')

    await db.close()
  })

  // ---------- case (h): 'google' on phones[<key>] ----------
  it('(h) google on phones[key]: contacts.phones updated, snapshot.phones updated', async () => {
    const db = await freshDb('factory-rc-h')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })

    const cid = '01RCTEST0000000000000000H0'
    const rn = 'people/rc-h'
    const phoneKey = '+15550000001'
    const localPhone = { value: '+15550000001', type: 'mobile', label: 'old' }
    const googlePhone = { value: '+15550000001', type: 'work', label: 'new' }
    const localArr = [localPhone]
    const snapshotArr = [{ value: '+15550000001', type: 'home' }]

    const conflictId = await seedConflict(db, {
      dbName: 'factory-rc-h',
      contactId: cid,
      googleResourceName: rn,
      fieldPath: `phones[${phoneKey}]:diverged`,
      baseValueJson: JSON.stringify({ value: '+15550000001', type: 'home' }),
      googleValueJson: JSON.stringify(googlePhone),
      localValueJson: JSON.stringify(localPhone),
      contactExtra: { phones: JSON.stringify(localArr) },
      snapshotPayload: { phones: snapshotArr },
    })

    await runtime.resolveConflict(conflictId, 'google')

    // contacts.phones updated to Google version
    const contacts = await db.select<{ phones: string }>(
      'SELECT phones FROM contacts WHERE id = ?',
      [cid],
    )
    const contactPhones = JSON.parse(contacts[0]!.phones) as typeof localArr
    expect(contactPhones).toHaveLength(1)
    expect(contactPhones[0]).toMatchObject({ value: '+15550000001', type: 'work' })

    // snapshot.phones updated
    const snaps = await db.select<{ payload_json: string }>(
      'SELECT payload_json FROM google_contact_snapshots WHERE google_resource_name = ?',
      [rn],
    )
    const snapshotPayload = JSON.parse(snaps[0]!.payload_json) as Record<string, unknown>
    const snapPhones = snapshotPayload['phones'] as typeof localArr
    expect(snapPhones[0]).toMatchObject({ type: 'work' })

    await db.close()
  })

  // ---------- case (i): 'local' on phones[key]:deleted_remotely ----------
  it('(i) local on phones[key]:deleted_remotely: contacts unchanged, snapshot has local element', async () => {
    const db = await freshDb('factory-rc-i')
    const tokenStore = makeMemoryTokenStore()
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })

    const cid = '01RCTEST0000000000000000I0'
    const rn = 'people/rc-i'
    const phoneKey = '+15550000002'
    const localPhone = { value: '+15550000002', type: 'mobile', label: 'keep me' }
    const localArr = [localPhone]
    // Snapshot does NOT have the element (remote deleted it).
    const snapshotArr: unknown[] = []

    const conflictId = await seedConflict(db, {
      dbName: 'factory-rc-i',
      contactId: cid,
      googleResourceName: rn,
      fieldPath: `phones[${phoneKey}]:deleted_remotely`,
      baseValueJson: JSON.stringify({ value: '+15550000002', type: 'mobile' }),
      googleValueJson: null,
      localValueJson: JSON.stringify(localPhone),
      contactExtra: { phones: JSON.stringify(localArr) },
      snapshotPayload: { phones: snapshotArr },
    })

    await runtime.resolveConflict(conflictId, 'local')

    // contacts.phones unchanged
    const contacts = await db.select<{ phones: string }>(
      'SELECT phones FROM contacts WHERE id = ?',
      [cid],
    )
    const contactPhones = JSON.parse(contacts[0]!.phones) as typeof localArr
    expect(contactPhones).toHaveLength(1)
    expect(contactPhones[0]).toMatchObject({ value: '+15550000002' })

    // snapshot.phones now contains the local element (so future pull won't re-conflict)
    const snaps = await db.select<{ payload_json: string }>(
      'SELECT payload_json FROM google_contact_snapshots WHERE google_resource_name = ?',
      [rn],
    )
    const snapshotPayload = JSON.parse(snaps[0]!.payload_json) as Record<string, unknown>
    const snapPhones = snapshotPayload['phones'] as typeof localArr
    const found = snapPhones.find((p) => p.value === '+15550000002')
    expect(found).toBeDefined()

    await db.close()
  })

  // ---------- case (j): atomicity rollback ----------
  it('(j) atomicity: error during resolution rolls back all mutations', async () => {
    const db = await freshDb('factory-rc-j')
    const tokenStore = makeMemoryTokenStore()
    // Use an invalid resolution to trigger a throw inside the transaction.
    // We'll trigger it by calling resolveConflict with a fieldPath that resolves
    // to an unknown column, exercising the error path inside the transaction.
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })

    const cid = '01RCTEST0000000000000000J0'
    const rn = 'people/rc-j'

    const conflictId = await seedConflict(db, {
      dbName: 'factory-rc-j',
      contactId: cid,
      googleResourceName: rn,
      fieldPath: '__unknownField__',
      baseValueJson: JSON.stringify('base'),
      googleValueJson: JSON.stringify('google'),
      localValueJson: JSON.stringify('local'),
      contactExtra: {},
      snapshotPayload: {},
    })

    // Should throw due to unknown fieldPath
    await expect(runtime.resolveConflict(conflictId, 'google')).rejects.toThrow()

    // Conflict row must remain 'pending' (rollback)
    const conflicts = await db.select<{ status: string }>(
      'SELECT status FROM sync_conflicts WHERE id = ?',
      [conflictId],
    )
    expect(conflicts[0]?.status).toBe('pending')

    // No conflict_resolved log entry
    const logs = await db.select(
      `SELECT * FROM google_contacts_sync_log WHERE event = 'conflict_resolved'`,
    )
    expect(logs).toHaveLength(0)

    await db.close()
  })
})

// ---------------------------------------------------------------------------
// OAuth lifecycle: empty-string token, invalid_grant handling
// ---------------------------------------------------------------------------

describe('isConnected with empty-string token', () => {
  it('returns false when token store holds an empty string', async () => {
    const db = await freshDb('factory-test-isconnected-emptystr')
    const tokenStore = makeMemoryTokenStore()
    // Bypass the write guard — manually set empty string via the internal store
    await tokenStore.write('')
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
    })
    expect(await runtime.isConnected()).toBe(false)
    await db.close()
  })
})

describe('getAccessToken with empty refresh_token in store', () => {
  it('surfaces NOT_CONNECTED error when token store holds an empty string', async () => {
    const db = await freshDb('factory-test-getaccesstoken-emptystr')
    const tokenStore = makeMemoryTokenStore()
    await tokenStore.write('')
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
      fetchImpl,
    })

    // pullEngine.run() returns { kind: 'failed', error } rather than rejecting.
    // Insert a client_id so we get past the consent-expired check.
    await db.execute(
      `INSERT INTO meta (key, value) VALUES ('google_contacts.oauth_client_id', '"test-client-id"')`,
    )
    // Insert a consent record so CONSENT_EXPIRED is not hit before getAccessToken.
    const recentConsent = new Date(Date.now() - 1000).toISOString()
    await db.execute(
      `INSERT INTO google_contacts_sync_log (run_id, ts, event, level, payload_json)
       VALUES ('consent-run', ?, 'oauth_consent', 'info', '{}')`,
      [recentConsent],
    )

    const result = await runtime.pullEngine.run({ confirmFn: async () => true })
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.error.message).toContain('NOT_CONNECTED')
    }

    await db.close()
  })
})

describe('getAccessToken when refresh fails with InvalidGrantError', () => {
  it('clears tokenStore, appends oauth_disconnected with reason=invalid_grant, and rethrows', async () => {
    const db = await freshDb('factory-test-getaccesstoken-invalidgrant')
    const tokenStore = makeMemoryTokenStore()
    await tokenStore.write('stored-refresh-token')

    // fetchImpl that simulates invalid_grant on token refresh
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
      text: async () => '{"error":"invalid_grant"}',
    }) as unknown as typeof fetch

    // We need a client_id in the meta table so getAccessToken proceeds to the refresh call
    const runtime = makeGoogleSyncRuntime({
      db,
      tokenStore,
      oauthInvoke: noopInvoke,
      oauthOpenUrl: noopOpenUrl,
      fetchImpl,
    })

    // Insert a client_id into meta so the code gets past the NO_CLIENT_ID check
    await db.execute(
      `INSERT INTO meta (key, value) VALUES ('google_contacts.oauth_client_id', '"test-client-id"')`,
    )

    // pullEngine.run() returns { kind: 'failed', error } rather than rejecting.
    // Insert a consent record so CONSENT_EXPIRED is not hit before getAccessToken.
    const recentConsent = new Date(Date.now() - 1000).toISOString()
    await db.execute(
      `INSERT INTO google_contacts_sync_log (run_id, ts, event, level, payload_json)
       VALUES ('consent-run', ?, 'oauth_consent', 'info', '{}')`,
      [recentConsent],
    )

    const result = await runtime.pullEngine.run({ confirmFn: async () => true })
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      // InvalidGrantError is rethrown as-is and surfaces in the result.
      expect(result.error).toBeInstanceOf(InvalidGrantError)
      expect(result.error.message).toContain('INVALID_GRANT')
    }

    // tokenStore must be cleared
    expect(await tokenStore.read()).toBeNull()

    // oauth_disconnected event with reason=invalid_grant must be logged
    const logs = await db.select<{ event: string; payload_json: string }>(
      `SELECT event, payload_json FROM google_contacts_sync_log WHERE event = 'oauth_disconnected'`,
    )
    expect(logs.length).toBeGreaterThanOrEqual(1)
    const payload = JSON.parse(logs[0]!.payload_json) as { reason: string }
    expect(payload.reason).toBe('invalid_grant')

    await db.close()
  })
})
