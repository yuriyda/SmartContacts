// @vitest-environment node
// Critical safety test L6.1: confirms PullEngine never issues non-GET requests
// to people.googleapis.com during a pull cycle.
//
// RO-INVARIANT: INV-1 (read-only), L2.1 (method whitelist), L3.1 (no write methods).
//
// Uses a hand-rolled fetch stub (no msw dependency needed) that:
//  - Responds 200 + fixture for GET requests to googleapis.com endpoints.
//  - Responds 200 for POST to oauth2.googleapis.com (token exchange — not a write).
//  - Responds 500 with WRITE_DETECTED for any non-GET to people.googleapis.com.
//  - Records all requests for post-run assertion.

import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { openWaSqliteAdapter } from '../../../db/wa-sqlite-backend'
import { applyMigrations } from '../../../db/migrations'
import { ulid } from '../../../ulid'
import { Applier } from '../read/applier'
import { SnapshotRepo } from '../read/snapshot-repo'
import { ConflictRepo } from '../read/conflict-repo'
import { SyncLogRepo } from '../read/sync-log-repo'
import { PullEngine } from '../read/pull-engine'
import type { PullEngineDeps, GoogleContactsReadRepo } from '../read/pull-engine'
import { computeChangeset } from '../read/differ'
import { fetchAll } from '../read/fetcher'
import { GoogleContactsClient } from '../read/client'
import type { DbAdapter } from '../../../db/adapter'
import type { NormalizedContact } from '../read/types'

// ---------------------------------------------------------------------------
// Recorded request shape
// ---------------------------------------------------------------------------

interface RecordedRequest {
  method: string
  url: string
}

// ---------------------------------------------------------------------------
// Hand-rolled fetch stub
// ---------------------------------------------------------------------------

/** Fixture response for connections (Alice only). */
const CONNECTIONS_FIXTURE = JSON.stringify({
  connections: [
    {
      resourceName: 'people/alice',
      etag: 'etag-alice',
      metadata: {
        sources: [
          { type: 'CONTACT', id: 'alice', etag: 'etag-alice', updateTime: '2026-05-01T00:00:00Z' },
        ],
      },
      names: [{ displayName: 'Alice Smith', givenName: 'Alice', familyName: 'Smith' }],
      emailAddresses: [],
      phoneNumbers: [],
      memberships: [],
    },
  ],
  nextSyncToken: 'sync-token-1',
})

const CONTACT_GROUPS_FIXTURE = JSON.stringify({
  contactGroups: [],
})

const OAUTH_TOKEN_FIXTURE = JSON.stringify({
  access_token: 'fresh-token',
  token_type: 'Bearer',
  expires_in: 3600,
})

const nonGetAttempts: RecordedRequest[] = []
const getAttempts: RecordedRequest[] = []

/** Fetch stub: record all requests, block non-GET to people.googleapis.com. */
function makeSafeFetch(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()

    const record: RecordedRequest = { method, url }

    if (url.includes('people.googleapis.com') && method !== 'GET') {
      // Non-GET to People API — this is a WRITE and must never happen
      nonGetAttempts.push(record)
      return new Response(JSON.stringify({ error: 'WRITE_DETECTED' }), { status: 500 })
    }

    if (method === 'POST' && url.includes('oauth2.googleapis.com')) {
      // OAuth token refresh — POST is expected here
      return new Response(OAUTH_TOKEN_FIXTURE, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (method === 'GET') {
      getAttempts.push(record)

      if (url.includes('people/me/connections') || url.includes('people.googleapis.com')) {
        if (url.includes('contactGroups')) {
          return new Response(CONTACT_GROUPS_FIXTURE, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(CONNECTIONS_FIXTURE, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Fallback: return empty 200
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// ---------------------------------------------------------------------------
// DB + deps setup
// ---------------------------------------------------------------------------

async function freshDb(): Promise<DbAdapter> {
  const db = await openWaSqliteAdapter(`no-write-test-${ulid()}`)
  await applyMigrations(db)
  return db
}

function makeContactsReadRepo(db: DbAdapter): GoogleContactsReadRepo {
  return {
    async listGoogleContacts(): Promise<NormalizedContact[]> {
      const rows = await db.select<{
        google_resource_name: string
        google_etag: string | null
        google_last_synced_at: string | null
        display_name: string | null
      }>(
        `SELECT google_resource_name, google_etag, google_last_synced_at, display_name
         FROM contacts WHERE google_resource_name IS NOT NULL AND deleted_at IS NULL`,
      )
      return rows.map(
        (r): NormalizedContact => ({
          googleResourceName: r.google_resource_name,
          etag: r.google_etag ?? '',
          updateTime: r.google_last_synced_at ?? '',
          displayName: r.display_name ?? undefined,
          phones: [],
          emails: [],
          addresses: [],
          events: [],
          organizations: [],
          urls: [],
          imClients: [],
          userDefined: {},
          photoUrl: null,
          photoContentHash: null,
          labelResourceNames: [],
        }),
      )
    },
  }
}

// ---------------------------------------------------------------------------
// No-write safety test
// ---------------------------------------------------------------------------

describe('PullEngine no-write safety (L6.1)', () => {
  let db: DbAdapter
  let pullResult: Awaited<ReturnType<PullEngine['run']>>

  beforeAll(async () => {
    db = await freshDb()

    // Seed a fresh consent so the consent gate passes
    await db.execute(
      `INSERT INTO google_contacts_sync_log (run_id, ts, event, level, payload_json)
       VALUES ('seed', ?, 'oauth_consent', 'info', NULL)`,
      [new Date().toISOString()],
    )

    const safeFetch = makeSafeFetch()

    // Build client with the intercepting fetch stub
    const client = new GoogleContactsClient({
      tokenSource: async () => 'fake-access-token',
      fetchImpl: safeFetch,
    })

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

    const deps: PullEngineDeps = {
      client,
      fetcher: fetchAll,
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
      consentPolicy: { isConsentFresh: () => true },
      getAccessToken: async () => 'fake-access-token',
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
    pullResult = await engine.run({ confirmFn: async () => true })
  })

  it('pull completed successfully (applied or up_to_date)', () => {
    expect(['applied', 'up_to_date']).toContain(pullResult.kind)
  })

  it('at least one GET was made to googleapis.com (API was actually called)', () => {
    expect(getAttempts.length).toBeGreaterThan(0)
  })

  it('ZERO non-GET requests were made to people.googleapis.com (no writes)', () => {
    const peopleWrites = nonGetAttempts.filter((r) => r.url.includes('people.googleapis.com'))
    expect(peopleWrites).toHaveLength(0)
  })

  it('contacts table has Alice after successful pull', async () => {
    const rows = await db.select<{ display_name: string }>(
      "SELECT display_name FROM contacts WHERE google_resource_name = 'people/alice'",
    )
    expect(rows[0]?.display_name).toBe('Alice Smith')
  })
})
