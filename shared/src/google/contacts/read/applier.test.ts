// @vitest-environment node
// Tests for Applier — atomic Changeset application to local DB.
// RO-INVARIANT: INV-2 (atomic transaction), INV-6 (apply only after confirm).
//
// Rules:
//  - Each test creates its own isolated in-memory DB (unique name).
//  - fake-indexeddb/auto must be imported before openWaSqliteAdapter.
//  - Do NOT mock DbAdapter — test against the real wa-sqlite backend.
//  - Covers: insert, update, delete, conflicts, labels, atomicity, idempotency.

import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { openWaSqliteAdapter } from '../../../db/wa-sqlite-backend'
import { applyMigrations } from '../../../db/migrations'
import { makeContactsRepo } from '../../../db/contactsRepo'
import { ulid } from '../../../ulid'
import { Applier } from './applier'
import type { Changeset } from './applier'
import type { FieldUpdate, ConflictRecord } from './differ'
import { SnapshotRepo } from './snapshot-repo'
import { ConflictRepo } from './conflict-repo'
import { SyncLogRepo } from './sync-log-repo'
import type { DbAdapter } from '../../../db/adapter'
import type { NormalizedContact } from './types'
import type { GoogleLabelRow } from './label-repo'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dbCounter = 0

async function freshDb(): Promise<DbAdapter> {
  dbCounter++
  const db = await openWaSqliteAdapter(`applier-test-${dbCounter}`)
  await applyMigrations(db)
  return db
}

function makeApplier(db: DbAdapter): Applier {
  return new Applier({
    db,
    snapshotRepo: new SnapshotRepo(db),
    conflictRepo: new ConflictRepo(db),
    syncLogRepo: new SyncLogRepo(db),
    contactsRepo: {
      async listByGoogleResourceName(resourceName: string) {
        const rows = await db.select<{ id: string }>(
          'SELECT id FROM contacts WHERE google_resource_name = ?',
          [resourceName],
        )
        return rows[0] ?? null
      },
    },
  })
}

function makeNormalized(over: Partial<NormalizedContact> = {}): NormalizedContact {
  return {
    googleResourceName: 'people/c1',
    etag: 'etag-1',
    updateTime: '2026-05-10T10:00:00Z',
    displayName: 'Alice Smith',
    givenName: 'Alice',
    familyName: 'Smith',
    phones: [],
    emails: [],
    addresses: [],
    events: [],
    birthdays: [],
    relations: [],
    organizations: [],
    urls: [],
    imClients: [],
    userDefined: {},
    photoUrl: null,
    photoContentHash: null,
    labelResourceNames: [],
    ...over,
  }
}

function makeLabel(override: Partial<GoogleLabelRow> = {}): GoogleLabelRow {
  return {
    resourceName: 'contactGroups/default',
    name: 'Default',
    groupType: 'system',
    etag: 'etag-label-1',
    lastSyncedAt: '2026-05-10T10:00:00Z',
    ...override,
  }
}

function emptyChangeset(runId = 'run-1'): Changeset {
  return {
    runId,
    cleanInserts: [],
    cleanUpdates: [],
    cleanDeletes: [],
    conflicts: [],
    labels: { full: [], memberships: new Map() },
    updatedNormalized: new Map(),
    counts: { inserts: 0, updates: 0, deletes: 0, conflicts: 0 },
  }
}

async function seedContact(db: DbAdapter, googleResourceName: string): Promise<string> {
  const repo = makeContactsRepo(db, 'DEV')
  const contact = await repo.upsert({
    id: ulid(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lamportTs: 0,
    deviceId: 'DEV',
    displayName: 'Existing Contact',
    googleResourceName,
    googleEtag: 'old-etag',
    googleLastSyncedAt: new Date().toISOString(),
  })
  return contact.id
}

// ---------------------------------------------------------------------------
// (a) cleanInsert: new contact row + snapshot created
// ---------------------------------------------------------------------------

describe('Applier: cleanInsert creates contact and snapshot', () => {
  let db: DbAdapter

  beforeAll(async () => {
    db = await freshDb()
    const applier = makeApplier(db)
    const normalized = makeNormalized({ googleResourceName: 'people/insert-1', givenName: 'Bob' })
    const changeset: Changeset = {
      ...emptyChangeset('run-insert'),
      cleanInserts: [normalized],
    }
    await applier.apply(changeset)
  })

  it('contacts table has the new row', async () => {
    const rows = await db.select<{ google_resource_name: string; given_name: string }>(
      'SELECT google_resource_name, given_name FROM contacts WHERE google_resource_name = ?',
      ['people/insert-1'],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.given_name).toBe('Bob')
  })

  it('google_contact_snapshots has the row', async () => {
    const repo = new SnapshotRepo(db)
    const snap = await repo.get('people/insert-1')
    expect(snap).not.toBeNull()
    expect(snap!.etag).toBe('etag-1')
    const payload = JSON.parse(snap!.payloadJson) as NormalizedContact
    expect(payload.givenName).toBe('Bob')
  })

  it('apply_complete logged', async () => {
    const logs = await db.select<{ event: string; payload_json: string }>(
      "SELECT event, payload_json FROM google_contacts_sync_log WHERE run_id = 'run-insert'",
    )
    expect(logs.some((l) => l.event === 'apply_complete')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (b) cleanUpdate: contact row field changes, snapshot updated
// ---------------------------------------------------------------------------

describe('Applier: cleanUpdate modifies contact field and snapshot', () => {
  let db: DbAdapter
  let contactId: string

  beforeAll(async () => {
    db = await freshDb()
    contactId = await seedContact(db, 'people/update-1')
    await new SnapshotRepo(db).upsert({
      googleResourceName: 'people/update-1',
      etag: 'old-etag',
      updateTime: '2026-05-01T00:00:00Z',
      payloadJson: JSON.stringify(makeNormalized({ googleResourceName: 'people/update-1' })),
      lastSyncedAt: '2026-05-01T00:00:00Z',
    })

    const applier = makeApplier(db)
    const normalized = makeNormalized({
      googleResourceName: 'people/update-1',
      etag: 'new-etag',
      updateTime: '2026-05-10T00:00:00Z',
      displayName: 'Alice Updated',
    })
    const fieldUpdate: FieldUpdate = {
      contactId,
      googleResourceName: 'people/update-1',
      fieldPath: 'displayName',
      newValue: 'Alice Updated',
    }
    const changeset: Changeset = {
      ...emptyChangeset('run-update'),
      cleanUpdates: [fieldUpdate],
      updatedNormalized: new Map([['people/update-1', normalized]]),
      counts: { inserts: 0, updates: 1, deletes: 0, conflicts: 0 },
    }
    await applier.apply(changeset)
  })

  it('contacts row has the updated display_name', async () => {
    const rows = await db.select<{ display_name: string }>(
      'SELECT display_name FROM contacts WHERE google_resource_name = ?',
      ['people/update-1'],
    )
    expect(rows[0]!.display_name).toBe('Alice Updated')
  })

  it('snapshot payload_json reflects new displayName', async () => {
    const snap = await new SnapshotRepo(db).get('people/update-1')
    expect(snap).not.toBeNull()
    expect(snap!.etag).toBe('new-etag')
    const payload = JSON.parse(snap!.payloadJson) as NormalizedContact
    expect(payload.displayName).toBe('Alice Updated')
  })
})

// ---------------------------------------------------------------------------
// (c) cleanDelete: contact row gone, related rows cascade-deleted
// ---------------------------------------------------------------------------

describe('Applier: cleanDelete removes contact and snapshot', () => {
  let db: DbAdapter
  let contactId: string

  beforeAll(async () => {
    db = await freshDb()
    await db.execute('PRAGMA foreign_keys = ON')
    contactId = await seedContact(db, 'people/delete-1')
    await new SnapshotRepo(db).upsert({
      googleResourceName: 'people/delete-1',
      etag: 'etag-del',
      updateTime: '2026-05-01T00:00:00Z',
      payloadJson: '{}',
      lastSyncedAt: '2026-05-01T00:00:00Z',
    })

    const applier = makeApplier(db)
    const changeset: Changeset = {
      ...emptyChangeset('run-delete'),
      cleanDeletes: ['people/delete-1'],
    }
    await applier.apply(changeset)
  })

  it('contact row is gone', async () => {
    const rows = await db.select<{ id: string }>('SELECT id FROM contacts WHERE id = ?', [
      contactId,
    ])
    expect(rows).toHaveLength(0)
  })

  it('snapshot row is gone', async () => {
    const snap = await new SnapshotRepo(db).get('people/delete-1')
    expect(snap).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (d) conflicts: sync_conflicts has rows with status='pending'
// ---------------------------------------------------------------------------

describe('Applier: conflicts create pending sync_conflicts rows', () => {
  let db: DbAdapter
  let contactId: string

  beforeAll(async () => {
    db = await freshDb()
    contactId = await seedContact(db, 'people/conflict-1')

    const applier = makeApplier(db)
    const conflict: ConflictRecord = {
      contactId,
      googleResourceName: 'people/conflict-1',
      fieldPath: 'display_name',
      baseValueJson: '"Old Name"',
      googleValueJson: '"Google Name"',
      localValueJson: '"Local Name"',
      detectedAt: new Date().toISOString(),
    }
    const changeset: Changeset = {
      ...emptyChangeset('run-conflict'),
      conflicts: [conflict],
    }
    await applier.apply(changeset)
  })

  it('sync_conflicts has one row with status pending', async () => {
    const conflictRepo = new ConflictRepo(db)
    const pending = await conflictRepo.listPending({ contactId })
    expect(pending).toHaveLength(1)
    expect(pending[0]!.fieldPath).toBe('display_name')
    expect(pending[0]!.googleValueJson).toBe('"Google Name"')
    expect(pending[0]!.localValueJson).toBe('"Local Name"')
    expect(pending[0]!.status).toBe('pending')
  })
})

// ---------------------------------------------------------------------------
// (e) labels: google_labels replaced, memberships set
// ---------------------------------------------------------------------------

describe('Applier: labels are fully replaced and memberships set', () => {
  let db: DbAdapter
  let contactId: string

  beforeAll(async () => {
    db = await freshDb()
    contactId = await seedContact(db, 'people/label-contact-1')

    const applier = makeApplier(db)
    const labelA = makeLabel({
      resourceName: 'contactGroups/a',
      name: 'Friends',
      groupType: 'user',
    })
    const labelB = makeLabel({ resourceName: 'contactGroups/b', name: 'Family', groupType: 'user' })
    const changeset: Changeset = {
      ...emptyChangeset('run-labels'),
      labels: {
        full: [labelA, labelB],
        // Memberships in differ's output are keyed by googleResourceName; the
        // applier resolves to the real local ULID.
        memberships: new Map([['people/label-contact-1', ['contactGroups/a']]]),
      },
    }
    await applier.apply(changeset)
  })

  it('google_labels has both labels', async () => {
    const rows = await db.select<{ resource_name: string }>(
      'SELECT resource_name FROM google_labels ORDER BY resource_name',
    )
    expect(rows.map((r) => r.resource_name)).toEqual(['contactGroups/a', 'contactGroups/b'])
  })

  it('google_label_memberships has the membership', async () => {
    const rows = await db.select<{ contact_id: string; label_resource_name: string }>(
      'SELECT contact_id, label_resource_name FROM google_label_memberships WHERE contact_id = ?',
      [contactId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.label_resource_name).toBe('contactGroups/a')
  })

  it('second apply with different labels full-replaces (no old rows remain)', async () => {
    const db2 = await freshDb()
    await seedContact(db2, 'people/label-contact-2')
    const applier2 = makeApplier(db2)

    // First apply: labelA only
    await applier2.apply({
      ...emptyChangeset('run-labels-2a'),
      labels: {
        full: [makeLabel({ resourceName: 'contactGroups/a', name: 'Friends', groupType: 'user' })],
        memberships: new Map([['people/label-contact-2', ['contactGroups/a']]]),
      },
    })

    // Second apply: labelB only — labelA must be gone
    await applier2.apply({
      ...emptyChangeset('run-labels-2b'),
      labels: {
        full: [makeLabel({ resourceName: 'contactGroups/b', name: 'Family', groupType: 'user' })],
        memberships: new Map([['people/label-contact-2', ['contactGroups/b']]]),
      },
    })

    const rows = await db2.select<{ resource_name: string }>(
      'SELECT resource_name FROM google_labels',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.resource_name).toBe('contactGroups/b')
  })
})

// ---------------------------------------------------------------------------
// (f) Transaction atomicity: mid-apply error → full rollback + apply_failed log
// ---------------------------------------------------------------------------

describe('Applier: transaction atomicity — error triggers rollback', () => {
  let db: DbAdapter
  let applyError: Error | null = null

  beforeAll(async () => {
    db = await freshDb()
    await db.execute('PRAGMA foreign_keys = ON')

    // Force a mid-transaction SQL error AFTER cleanInsert + conflict insert by
    // emitting two labels that share a primary key (resource_name). The second
    // INSERT into google_labels triggers a UNIQUE constraint failure, rolling
    // back contact / snapshot / conflict writes that happened earlier in tx.
    const applier = makeApplier(db)
    const normalized = makeNormalized({ googleResourceName: 'people/atomic-1' })
    const conflict: ConflictRecord = {
      contactId: 'people/atomic-1', // surrogate; applier resolves to ULID
      googleResourceName: 'people/atomic-1',
      fieldPath: 'display_name',
      baseValueJson: null,
      googleValueJson: '"New"',
      localValueJson: '"Old"',
      detectedAt: new Date().toISOString(),
    }
    const labelA = makeLabel({ resourceName: 'contactGroups/dup', name: 'A', groupType: 'user' })
    const labelB = makeLabel({ resourceName: 'contactGroups/dup', name: 'B', groupType: 'user' })

    try {
      await applier.apply({
        ...emptyChangeset('run-atomic'),
        cleanInserts: [normalized],
        conflicts: [conflict],
        labels: {
          full: [labelA, labelB], // PK collision on second INSERT
          memberships: new Map(),
        },
      })
    } catch (err) {
      applyError = err instanceof Error ? err : new Error(String(err))
    }
  })

  it('apply() throws an error', () => {
    expect(applyError).not.toBeNull()
  })

  it('contacts table is empty (rollback verified)', async () => {
    const rows = await db.select<{ id: string }>('SELECT id FROM contacts')
    expect(rows).toHaveLength(0)
  })

  it('google_contact_snapshots is empty (rollback verified)', async () => {
    const snapshots = await db.select<{ google_resource_name: string }>(
      'SELECT google_resource_name FROM google_contact_snapshots',
    )
    expect(snapshots).toHaveLength(0)
  })

  it('sync_conflicts is empty (rollback verified)', async () => {
    const conflicts = await db.select<{ id: number }>('SELECT id FROM sync_conflicts')
    expect(conflicts).toHaveLength(0)
  })

  it('google_labels is empty (rollback verified)', async () => {
    const labels = await db.select<{ resource_name: string }>(
      'SELECT resource_name FROM google_labels',
    )
    expect(labels).toHaveLength(0)
  })

  it('apply_failed event logged (outside transaction)', async () => {
    const logs = await db.select<{ event: string }>(
      "SELECT event FROM google_contacts_sync_log WHERE run_id = 'run-atomic'",
    )
    expect(logs.some((l) => l.event === 'apply_failed')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (g) Idempotent re-apply: applying the same Changeset twice does not error
// ---------------------------------------------------------------------------

describe('Applier: idempotent re-apply of same cleanInsert Changeset', () => {
  let db: DbAdapter
  let secondError: Error | null = null

  beforeAll(async () => {
    db = await freshDb()
    const applier = makeApplier(db)
    const normalized = makeNormalized({
      googleResourceName: 'people/idem-1',
      givenName: 'Idempotent',
    })
    const changeset: Changeset = {
      ...emptyChangeset('run-idem'),
      cleanInserts: [normalized],
    }

    // First apply
    await applier.apply(changeset)

    // Second apply of same changeset — INSERT OR REPLACE handles the duplicate contact.
    // Snapshot upsert is INSERT OR REPLACE. No UNIQUE violation expected.
    try {
      await applier.apply({ ...changeset, runId: 'run-idem-2' })
    } catch (err) {
      secondError = err instanceof Error ? err : new Error(String(err))
    }
  })

  it('second apply does not throw', () => {
    expect(secondError).toBeNull()
  })

  it('contacts table has exactly one row (no duplicates)', async () => {
    const rows = await db.select<{ google_resource_name: string }>(
      'SELECT google_resource_name FROM contacts WHERE google_resource_name = ?',
      ['people/idem-1'],
    )
    expect(rows).toHaveLength(1)
  })

  it('snapshots table has exactly one row for the resource', async () => {
    const all = await new SnapshotRepo(db).listAll()
    const forResource = all.filter((s) => s.googleResourceName === 'people/idem-1')
    expect(forResource).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// (h) Photo pipeline: cleanInsert with photoBytes → avatars written; snapshot slim
// ---------------------------------------------------------------------------

describe('Applier: cleanInsert with photoBytes writes avatars and strips bytes from snapshot', () => {
  let db: DbAdapter
  let contactId: string
  const PHOTO_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
  const PHOTO_HASH = 'photo-hash-abc123'
  const PHOTO_MIME = 'image/jpeg'

  beforeAll(async () => {
    db = await freshDb()
    const applier = makeApplier(db)
    const normalized = makeNormalized({
      googleResourceName: 'people/photo-insert-1',
      givenName: 'PhotoBob',
      photoUrl: 'https://lh3.googleusercontent.com/photo.jpg',
      photoContentHash: PHOTO_HASH,
      photoBytes: PHOTO_BYTES,
      photoMime: PHOTO_MIME,
    })
    const changeset: Changeset = {
      ...emptyChangeset('run-photo-insert'),
      cleanInserts: [normalized],
    }
    await applier.apply(changeset)

    const rows = await db.select<{ id: string }>(
      'SELECT id FROM contacts WHERE google_resource_name = ?',
      ['people/photo-insert-1'],
    )
    contactId = rows[0]!.id
  })

  it('contacts.avatar_hash is set to photo hash', async () => {
    const rows = await db.select<{ avatar_hash: string }>(
      'SELECT avatar_hash FROM contacts WHERE id = ?',
      [contactId],
    )
    expect(rows[0]!.avatar_hash).toBe(PHOTO_HASH)
  })

  it('avatars table has the photo bytes and mime', async () => {
    const rows = await db.select<{ blob: Uint8Array; mime: string; hash: string }>(
      'SELECT blob, mime, hash FROM avatars WHERE contact_id = ?',
      [contactId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.mime).toBe(PHOTO_MIME)
    expect(rows[0]!.hash).toBe(PHOTO_HASH)
    // blob is stored; length should match.
    expect(rows[0]!.blob).toBeTruthy()
  })

  it('snapshot payload_json does NOT contain photoBytes', async () => {
    const snap = await new SnapshotRepo(db).get('people/photo-insert-1')
    expect(snap).not.toBeNull()
    const payload = JSON.parse(snap!.payloadJson) as Record<string, unknown>
    // photoBytes must not be serialized (transport-only).
    expect(payload['photoBytes']).toBeUndefined()
    expect(payload['photoMime']).toBeUndefined()
    // photoContentHash IS stored (not transport).
    expect(payload['photoContentHash']).toBe(PHOTO_HASH)
  })
})

// ---------------------------------------------------------------------------
// (i) Photo pipeline: cleanUpdate where photo changed → avatars updated
// ---------------------------------------------------------------------------

describe('Applier: cleanUpdate with photo change updates avatars table', () => {
  let db: DbAdapter
  let contactId: string
  const NEW_HASH = 'new-photo-hash-xyz'
  const NEW_BYTES = new Uint8Array([0x01, 0x02])

  beforeAll(async () => {
    db = await freshDb()
    contactId = await seedContact(db, 'people/photo-update-1')
    // Seed initial avatar.
    await db.execute(
      'INSERT INTO avatars (contact_id, blob, mime, source_url, fetched_at, hash) VALUES (?, ?, ?, NULL, ?, ?)',
      [contactId, new Uint8Array([0xff]), 'image/png', new Date().toISOString(), 'old-hash'],
    )
    await new SnapshotRepo(db).upsert({
      googleResourceName: 'people/photo-update-1',
      etag: 'old-etag',
      updateTime: '2026-05-01T00:00:00Z',
      payloadJson: JSON.stringify(
        makeNormalized({
          googleResourceName: 'people/photo-update-1',
          photoContentHash: 'old-hash',
        }),
      ),
      lastSyncedAt: '2026-05-01T00:00:00Z',
    })

    const applier = makeApplier(db)
    const normalized = makeNormalized({
      googleResourceName: 'people/photo-update-1',
      etag: 'new-etag',
      updateTime: '2026-05-10T00:00:00Z',
      photoUrl: 'https://lh3.googleusercontent.com/new.jpg',
      photoContentHash: NEW_HASH,
      photoBytes: NEW_BYTES,
      photoMime: 'image/webp',
    })
    const fieldUpdate: FieldUpdate = {
      contactId,
      googleResourceName: 'people/photo-update-1',
      fieldPath: 'photos[0]',
      newValue: 'https://lh3.googleusercontent.com/new.jpg',
    }
    const changeset: Changeset = {
      ...emptyChangeset('run-photo-update'),
      cleanUpdates: [fieldUpdate],
      updatedNormalized: new Map([['people/photo-update-1', normalized]]),
      counts: { inserts: 0, updates: 1, deletes: 0, conflicts: 0 },
    }
    await applier.apply(changeset)
  })

  it('avatars.hash is updated to new hash', async () => {
    const rows = await db.select<{ hash: string }>(
      'SELECT hash FROM avatars WHERE contact_id = ?',
      [contactId],
    )
    expect(rows[0]!.hash).toBe(NEW_HASH)
  })

  it('avatars.mime is updated', async () => {
    const rows = await db.select<{ mime: string }>(
      'SELECT mime FROM avatars WHERE contact_id = ?',
      [contactId],
    )
    expect(rows[0]!.mime).toBe('image/webp')
  })

  it('snapshot does not contain photoBytes', async () => {
    const snap = await new SnapshotRepo(db).get('people/photo-update-1')
    const payload = JSON.parse(snap!.payloadJson) as Record<string, unknown>
    expect(payload['photoBytes']).toBeUndefined()
    expect(payload['photoContentHash']).toBe(NEW_HASH)
  })
})

// ---------------------------------------------------------------------------
// (j) Photo conflict: pending_google_avatars written; existing avatars unchanged
// ---------------------------------------------------------------------------

describe('Applier: photo conflict writes pending_google_avatars; avatars unchanged', () => {
  let db: DbAdapter
  let contactId: string
  const LOCAL_HASH = 'local-hash'
  const GOOGLE_HASH = 'google-hash-conflict'
  const GOOGLE_BYTES = new Uint8Array([0x11, 0x22, 0x33])

  beforeAll(async () => {
    db = await freshDb()
    contactId = await seedContact(db, 'people/photo-conflict-1')
    // Seed existing local avatar.
    await db.execute(
      'INSERT INTO avatars (contact_id, blob, mime, source_url, fetched_at, hash) VALUES (?, ?, ?, NULL, ?, ?)',
      [contactId, new Uint8Array([0xaa, 0xbb]), 'image/jpeg', new Date().toISOString(), LOCAL_HASH],
    )

    const applier = makeApplier(db)
    const googleNormalized = makeNormalized({
      googleResourceName: 'people/photo-conflict-1',
      photoUrl: 'https://lh3.googleusercontent.com/conflict.jpg',
      photoContentHash: GOOGLE_HASH,
      photoBytes: GOOGLE_BYTES,
      photoMime: 'image/png',
    })
    const conflict: ConflictRecord = {
      contactId,
      googleResourceName: 'people/photo-conflict-1',
      fieldPath: 'photos[0]',
      baseValueJson: JSON.stringify('base-hash'),
      googleValueJson: JSON.stringify(GOOGLE_HASH),
      localValueJson: JSON.stringify(LOCAL_HASH),
      detectedAt: new Date().toISOString(),
    }
    const changeset: Changeset = {
      ...emptyChangeset('run-photo-conflict'),
      conflicts: [conflict],
      updatedNormalized: new Map([['people/photo-conflict-1', googleNormalized]]),
    }
    await applier.apply(changeset)
  })

  it('pending_google_avatars has the Google photo bytes', async () => {
    const rows = await db.select<{ hash: string; mime: string }>(
      'SELECT hash, mime FROM pending_google_avatars WHERE contact_id = ?',
      [contactId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.hash).toBe(GOOGLE_HASH)
    expect(rows[0]!.mime).toBe('image/png')
  })

  it('existing avatars row is unchanged (local photo preserved)', async () => {
    const rows = await db.select<{ hash: string }>(
      'SELECT hash FROM avatars WHERE contact_id = ?',
      [contactId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.hash).toBe(LOCAL_HASH)
  })

  it('sync_conflicts has a pending row for photos[0]', async () => {
    const pending = await new ConflictRepo(db).listPending({ contactId })
    const photoCf = pending.find((c) => c.fieldPath === 'photos[0]')
    expect(photoCf).toBeDefined()
    expect(photoCf!.googleValueJson).toBe(JSON.stringify(GOOGLE_HASH))
  })
})

// ---------------------------------------------------------------------------
// (k) cleanDelete with avatar: avatars row is deleted explicitly
// ---------------------------------------------------------------------------

describe('Applier: cleanDelete removes avatars row (no FK cascade on avatars)', () => {
  let db: DbAdapter
  let contactId: string

  beforeAll(async () => {
    db = await freshDb()
    await db.execute('PRAGMA foreign_keys = ON')
    contactId = await seedContact(db, 'people/delete-photo-1')
    await db.execute(
      'INSERT INTO avatars (contact_id, blob, mime, source_url, fetched_at, hash) VALUES (?, ?, ?, NULL, ?, ?)',
      [contactId, new Uint8Array([0x01]), 'image/jpeg', new Date().toISOString(), 'hash-del'],
    )
    await new SnapshotRepo(db).upsert({
      googleResourceName: 'people/delete-photo-1',
      etag: 'e',
      updateTime: '2026-05-01T00:00:00Z',
      payloadJson: '{}',
      lastSyncedAt: '2026-05-01T00:00:00Z',
    })

    const applier = makeApplier(db)
    const changeset: Changeset = {
      ...emptyChangeset('run-delete-photo'),
      cleanDeletes: ['people/delete-photo-1'],
    }
    await applier.apply(changeset)
  })

  it('avatars row is deleted', async () => {
    const rows = await db.select<{ contact_id: string }>(
      'SELECT contact_id FROM avatars WHERE contact_id = ?',
      [contactId],
    )
    expect(rows).toHaveLength(0)
  })
})
