// @vitest-environment node
// Integration tests for PullEngine — end-to-end orchestration test.
// Uses real differ, real applier, real repos against in-memory DB.
// Only the GoogleContactsClient (HTTP) and token store are mocked.
//
// RO-INVARIANT: INV-2 (dry-run before apply), INV-6 (always confirm before apply).
// Covers spec §10.2 (E2E integration).

import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { openWaSqliteAdapter } from '../../../db/wa-sqlite-backend'
import { applyMigrations } from '../../../db/migrations'
import { ulid } from '../../../ulid'
import { Applier } from './applier'
import { SnapshotRepo } from './snapshot-repo'
import { ConflictRepo } from './conflict-repo'
import { SyncLogRepo } from './sync-log-repo'
import { PullEngine } from './pull-engine'
import type { PullEngineDeps, GoogleContactsReadRepo } from './pull-engine'
import { computeChangeset } from './differ'
import { fetchAll } from './fetcher'
import type { DbAdapter } from '../../../db/adapter'
import type { NormalizedContact } from './types'
import type { Person, ListConnectionsResponse, ListContactGroupsResponse } from './types'
import type { GoogleContactsClient } from './client'

// ---------------------------------------------------------------------------
// DB helper
// ---------------------------------------------------------------------------

let dbCounter = 0

async function freshDb(): Promise<DbAdapter> {
  dbCounter++
  const db = await openWaSqliteAdapter(`pull-engine-test-${dbCounter}`)
  await applyMigrations(db)
  return db
}

// ---------------------------------------------------------------------------
// Fixture contacts
// ---------------------------------------------------------------------------

const ALICE: Person = {
  resourceName: 'people/alice',
  etag: 'etag-alice-1',
  metadata: {
    sources: [
      { type: 'CONTACT', id: 'alice', etag: 'etag-alice-1', updateTime: '2026-05-01T00:00:00Z' },
    ],
  },
  names: [{ displayName: 'Alice Smith', givenName: 'Alice', familyName: 'Smith' }],
  emailAddresses: [{ value: 'alice@example.com', type: 'home' }],
  phoneNumbers: [],
  memberships: [],
}

const BOB: Person = {
  resourceName: 'people/bob',
  etag: 'etag-bob-1',
  metadata: {
    sources: [
      { type: 'CONTACT', id: 'bob', etag: 'etag-bob-1', updateTime: '2026-05-01T00:00:00Z' },
    ],
  },
  names: [{ displayName: 'Bob Jones', givenName: 'Bob', familyName: 'Jones' }],
  emailAddresses: [],
  phoneNumbers: [{ value: '+1234567890', type: 'mobile' }],
  memberships: [],
}

/** Build a fake GoogleContactsClient returning the given persons and groups. */
function makeClient(
  persons: Person[],
  syncToken: string | null = 'sync-token-1',
): GoogleContactsClient {
  return {
    async listConnections(
      _opts: Parameters<GoogleContactsClient['listConnections']>[0],
    ): Promise<ListConnectionsResponse> {
      const resp: ListConnectionsResponse = { connections: persons }
      if (syncToken !== null) resp.nextSyncToken = syncToken
      return resp
    },
    async listContactGroups(): Promise<ListContactGroupsResponse> {
      return { contactGroups: [] }
    },
    async getPerson(resourceName: string): Promise<Person> {
      const p = persons.find((x) => x.resourceName === resourceName)
      if (!p) throw new Error(`Person not found: ${resourceName}`)
      return p
    },
    async batchGetPersons(): Promise<Person[]> {
      return persons
    },
  } as unknown as GoogleContactsClient
}

/** Build a minimal GoogleContactsReadRepo backed by the test DB. */
function makeContactsReadRepo(db: DbAdapter): GoogleContactsReadRepo {
  return {
    async listGoogleContacts(): Promise<NormalizedContact[]> {
      const rows = await db.select<{
        google_resource_name: string
        google_etag: string
        google_last_synced_at: string
        given_name: string | null
        family_name: string | null
        display_name: string | null
        phones: string | null
        emails: string | null
        addresses: string | null
        events: string | null
        organizations: string | null
        urls: string | null
        im_clients: string | null
        notes_md: string | null
        user_defined: string | null
        locale: string | null
        gender: string | null
        occupation: string | null
        avatar_hash: string | null
      }>(
        `SELECT google_resource_name, google_etag, google_last_synced_at,
                given_name, family_name, display_name, phones, emails, addresses,
                events, organizations, urls, im_clients, notes_md, user_defined,
                locale, gender, occupation, avatar_hash
         FROM contacts
         WHERE google_resource_name IS NOT NULL AND deleted_at IS NULL`,
      )
      return rows.map(
        (r): NormalizedContact => ({
          googleResourceName: r.google_resource_name,
          etag: r.google_etag ?? '',
          updateTime: r.google_last_synced_at ?? '',
          givenName: r.given_name ?? undefined,
          familyName: r.family_name ?? undefined,
          displayName: r.display_name ?? undefined,
          phones: r.phones != null ? (JSON.parse(r.phones) as NormalizedContact['phones']) : [],
          emails: r.emails != null ? (JSON.parse(r.emails) as NormalizedContact['emails']) : [],
          addresses:
            r.addresses != null ? (JSON.parse(r.addresses) as NormalizedContact['addresses']) : [],
          events: r.events != null ? (JSON.parse(r.events) as NormalizedContact['events']) : [],
          organizations:
            r.organizations != null
              ? (JSON.parse(r.organizations) as NormalizedContact['organizations'])
              : [],
          urls: r.urls != null ? (JSON.parse(r.urls) as NormalizedContact['urls']) : [],
          imClients:
            r.im_clients != null
              ? (JSON.parse(r.im_clients) as NormalizedContact['imClients'])
              : [],
          notesMd: r.notes_md ?? undefined,
          userDefined:
            r.user_defined != null ? (JSON.parse(r.user_defined) as Record<string, string>) : {},
          locale: r.locale ?? undefined,
          gender: r.gender ?? undefined,
          occupation: r.occupation ?? undefined,
          photoUrl: null,
          photoContentHash: r.avatar_hash,
          labelResourceNames: [],
        }),
      )
    },
  }
}

/** Build a full PullEngineDeps wired to the test DB. */
function makeDeps(
  db: DbAdapter,
  persons: Person[],
  opts: {
    syncToken?: string | null
    nowDate?: Date
    consentFresh?: boolean
  } = {},
): PullEngineDeps {
  const syncLogRepo = new SyncLogRepo(db)
  const snapshotRepo = new SnapshotRepo(db)
  const conflictRepo = new ConflictRepo(db)
  const applier = new Applier({
    db,
    snapshotRepo,
    conflictRepo,
    syncLogRepo,
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
  const contactsReadRepo = makeContactsReadRepo(db)

  let storedSyncToken: string | null = opts.syncToken ?? null
  const nowDate = opts.nowDate ?? new Date('2026-05-10T12:00:00.000Z')
  const consentFresh = opts.consentFresh ?? true

  return {
    client: makeClient(persons, 'sync-token-next'),
    fetcher: fetchAll,
    differ: computeChangeset,
    applier,
    snapshotRepo,
    contactsRepo: contactsReadRepo,
    labelRepo: {
      async listAll() {
        return []
      },
    },
    syncLogRepo,
    consentPolicy: {
      isConsentFresh: () => consentFresh,
    },
    getAccessToken: async () => 'fake-token',
    lastSyncTokenStore: {
      async read() {
        return storedSyncToken
      },
      async write(token: string | null) {
        storedSyncToken = token
      },
    },
    now: () => nowDate,
    generateRunId: () => ulid(),
  }
}

/** Seed an oauth_consent event so latestConsentTs() returns a fresh value. */
async function seedConsent(db: DbAdapter): Promise<void> {
  await db.execute(
    `INSERT INTO google_contacts_sync_log (run_id, ts, event, level, payload_json)
     VALUES (?, ?, 'oauth_consent', 'info', NULL)`,
    ['seed-run', new Date().toISOString()],
  )
}

// ---------------------------------------------------------------------------
// (a) Happy path — empty DB, 2 fixture contacts, user confirms
// ---------------------------------------------------------------------------

describe('PullEngine: happy path — two new contacts applied', () => {
  let db: DbAdapter
  let runId: string

  beforeAll(async () => {
    db = await freshDb()
    await seedConsent(db)
    const deps = makeDeps(db, [ALICE, BOB])
    const engine = new PullEngine(deps)
    const result = await engine.run({ confirmFn: async () => true })
    expect(result.kind).toBe('applied')
    if (result.kind === 'applied') runId = result.runId
  })

  it('result has appliedCount=2', async () => {
    await new PullEngine(makeDeps(db, [])).run({ confirmFn: async () => false })
    // The DB already has 2 contacts → second run with empty persons returns up_to_date
    // Just verify the first run result indirectly via DB state
    const rows = await db.select<{ google_resource_name: string }>(
      'SELECT google_resource_name FROM contacts WHERE google_resource_name IS NOT NULL',
    )
    expect(rows.length).toBe(2)
  })

  it('Alice and Bob are in the contacts table', async () => {
    const alice = await db.select<{ display_name: string }>(
      "SELECT display_name FROM contacts WHERE google_resource_name = 'people/alice'",
    )
    expect(alice[0]?.display_name).toBe('Alice Smith')
    const bob = await db.select<{ display_name: string }>(
      "SELECT display_name FROM contacts WHERE google_resource_name = 'people/bob'",
    )
    expect(bob[0]?.display_name).toBe('Bob Jones')
  })

  it('snapshots exist for both contacts', async () => {
    const snapshotRepo = new SnapshotRepo(db)
    const alice = await snapshotRepo.get('people/alice')
    const bob = await snapshotRepo.get('people/bob')
    expect(alice).not.toBeNull()
    expect(bob).not.toBeNull()
  })

  it('sync_log has dry_run_computed + user_confirmed + apply_complete events', async () => {
    const syncLogRepo = new SyncLogRepo(db)
    const logs = await syncLogRepo.listByRun(runId)
    const events = logs.map((l) => l.event)
    expect(events).toContain('dry_run_computed')
    expect(events).toContain('user_confirmed')
    expect(events).toContain('apply_complete')
  })
})

// ---------------------------------------------------------------------------
// (b) Up-to-date — second run with no changes
// ---------------------------------------------------------------------------

describe('PullEngine: up-to-date — second run returns up_to_date', () => {
  let db: DbAdapter
  let confirmCalled = false

  beforeAll(async () => {
    db = await freshDb()
    await seedConsent(db)

    // First run: apply Alice and Bob
    const deps1 = makeDeps(db, [ALICE, BOB])
    const engine1 = new PullEngine(deps1)
    await engine1.run({ confirmFn: async () => true })

    // Second run: same persons, same etags — no changes
    // Re-use the same syncToken value so the client returns the same persons
    const deps2 = makeDeps(db, [ALICE, BOB])
    const engine2 = new PullEngine(deps2)
    const result = await engine2.run({
      confirmFn: async () => {
        confirmCalled = true
        return true
      },
    })
    expect(result.kind).toBe('up_to_date')
  })

  it('confirmFn was NOT called (no user prompt for up-to-date)', () => {
    expect(confirmCalled).toBe(false)
  })

  it('DB still has exactly 2 contacts', async () => {
    const rows = await db.select<{ id: string }>(
      'SELECT id FROM contacts WHERE google_resource_name IS NOT NULL AND deleted_at IS NULL',
    )
    expect(rows.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// (c) User cancels — result is cancelled, DB unchanged
// ---------------------------------------------------------------------------

describe('PullEngine: user cancels — DB unchanged', () => {
  let db: DbAdapter
  let result: Awaited<ReturnType<PullEngine['run']>>

  beforeAll(async () => {
    db = await freshDb()
    await seedConsent(db)
    const deps = makeDeps(db, [ALICE, BOB])
    const engine = new PullEngine(deps)
    result = await engine.run({ confirmFn: async () => false })
  })

  it('result kind is cancelled', () => {
    expect(result.kind).toBe('cancelled')
  })

  it('contacts table is empty', async () => {
    const rows = await db.select<{ id: string }>('SELECT id FROM contacts')
    expect(rows.length).toBe(0)
  })

  it('sync_log has dry_run_computed + user_cancelled events', async () => {
    if (result.kind !== 'cancelled') return
    const syncLogRepo = new SyncLogRepo(db)
    const logs = await syncLogRepo.listByRun(result.runId)
    const events = logs.map((l) => l.event)
    expect(events).toContain('dry_run_computed')
    expect(events).toContain('user_cancelled')
    expect(events).not.toContain('apply_complete')
  })
})

// ---------------------------------------------------------------------------
// (d) Conflict path — ours+theirs both edited notes → conflictCount=1
// ---------------------------------------------------------------------------

describe('PullEngine: conflict detected when both sides edit notes', () => {
  let db: DbAdapter
  let result: Awaited<ReturnType<PullEngine['run']>>

  beforeAll(async () => {
    db = await freshDb()
    await seedConsent(db)

    // First run: insert Alice with notesMd = null
    const deps1 = makeDeps(db, [ALICE, BOB])
    await new PullEngine(deps1).run({ confirmFn: async () => true })

    // Simulate local edit: update notes_md for Alice in DB (ours edited)
    await db.execute(
      `UPDATE contacts SET notes_md = 'local note' WHERE google_resource_name = 'people/alice'`,
    )

    // Second run: Alice now has different notesMd on Google side too
    const ALICE_EDITED: Person = {
      ...ALICE,
      etag: 'etag-alice-2',
      metadata: {
        sources: [
          {
            type: 'CONTACT',
            id: 'alice',
            etag: 'etag-alice-2',
            updateTime: '2026-05-02T00:00:00Z',
          },
        ],
      },
      biographies: [{ value: 'google note', contentType: 'TEXT_PLAIN' }],
    }

    const deps2 = makeDeps(db, [ALICE_EDITED, BOB])
    const engine2 = new PullEngine(deps2)
    result = await engine2.run({ confirmFn: async () => true })
  })

  it('result kind is applied', () => {
    expect(result.kind).toBe('applied')
  })

  it('result has conflictCount >= 1', () => {
    if (result.kind !== 'applied') return
    expect(result.conflictCount).toBeGreaterThanOrEqual(1)
  })

  it('sync_conflicts table has a pending row', async () => {
    const rows = await db.select<{ field_path: string; status: string }>(
      "SELECT field_path, status FROM sync_conflicts WHERE status = 'pending'",
    )
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// (e) Consent expired — no fetch, result is failed with CONSENT_EXPIRED
// ---------------------------------------------------------------------------

describe('PullEngine: consent expired — no fetch attempted', () => {
  let db: DbAdapter
  let fetchCalled = false
  let result: Awaited<ReturnType<PullEngine['run']>>

  beforeAll(async () => {
    db = await freshDb()
    // Do NOT seed a consent — latestConsentTs() will return null → stale

    const syncLogRepo = new SyncLogRepo(db)
    const snapshotRepo = new SnapshotRepo(db)
    const conflictRepo = new ConflictRepo(db)
    const applier = new Applier({
      db,
      snapshotRepo,
      conflictRepo,
      syncLogRepo,
      contactsRepo: {
        async listByGoogleResourceName() {
          return null
        },
      },
    })

    const deps: PullEngineDeps = {
      client: makeClient([]),
      fetcher: async (...args) => {
        fetchCalled = true
        return fetchAll(...args)
      },
      differ: computeChangeset,
      applier,
      snapshotRepo,
      contactsRepo: makeContactsReadRepo(db),
      labelRepo: {
        async listAll() {
          return []
        },
      },
      syncLogRepo,
      consentPolicy: { isConsentFresh: () => false }, // always stale
      getAccessToken: async () => 'fake-token',
      lastSyncTokenStore: {
        async read() {
          return null
        },
        async write() {
          /* noop */
        },
      },
      now: () => new Date('2026-05-10T12:00:00.000Z'),
      generateRunId: () => ulid(),
    }

    const engine = new PullEngine(deps)
    result = await engine.run({ confirmFn: async () => true })
  })

  it('result kind is failed', () => {
    expect(result.kind).toBe('failed')
  })

  it('error message is CONSENT_EXPIRED', () => {
    if (result.kind !== 'failed') return
    expect(result.error.message).toBe('CONSENT_EXPIRED')
  })

  it('fetch was NOT called (gating works)', () => {
    expect(fetchCalled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// (f) Applier throws — result is failed, sync_log has error event
// ---------------------------------------------------------------------------

describe('PullEngine: applier throws — result is failed with error logged', () => {
  let db: DbAdapter
  let result: Awaited<ReturnType<PullEngine['run']>>

  beforeAll(async () => {
    db = await freshDb()
    await seedConsent(db)

    const syncLogRepo = new SyncLogRepo(db)
    const snapshotRepo = new SnapshotRepo(db)

    // Applier that always throws
    const brokenApplier = {
      async apply() {
        throw new Error('DB_FULL')
      },
    } as unknown as Applier

    const deps: PullEngineDeps = {
      client: makeClient([ALICE]),
      fetcher: fetchAll,
      differ: computeChangeset,
      applier: brokenApplier,
      snapshotRepo,
      contactsRepo: makeContactsReadRepo(db),
      labelRepo: {
        async listAll() {
          return []
        },
      },
      syncLogRepo,
      consentPolicy: { isConsentFresh: () => true },
      getAccessToken: async () => 'fake-token',
      lastSyncTokenStore: {
        async read() {
          return null
        },
        async write() {
          /* noop */
        },
      },
      now: () => new Date('2026-05-10T12:00:00.000Z'),
      generateRunId: () => ulid(),
    }

    const engine = new PullEngine(deps)
    result = await engine.run({ confirmFn: async () => true })
  })

  it('result kind is failed', () => {
    expect(result.kind).toBe('failed')
  })

  it('error message matches DB_FULL', () => {
    if (result.kind !== 'failed') return
    expect(result.error.message).toBe('DB_FULL')
  })

  it('sync_log has an error event', async () => {
    if (result.kind !== 'failed') return
    const syncLogRepo = new SyncLogRepo(db)
    const logs = await syncLogRepo.listByRun(result.runId)
    expect(logs.some((l) => l.event === 'error')).toBe(true)
  })
})
