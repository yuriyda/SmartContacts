// Tests for fetchAll — covers pagination, syncToken handling, deletion markers,
// 410 recovery, and label fetching.
//
// Uses stub implementations of GoogleContactsClient and SyncLogRepo — no real
// DB or HTTP calls. All test cases are deterministic and isolated.
//
// Rules:
//  - No `any` types.
//  - Do NOT import DB adapters or real OAuth tokens.
//  - All comments must remain in English.

import { describe, it, expect, vi } from 'vitest'
import { fetchAll } from './fetcher'
import type { FetchAllDeps } from './fetcher'
import type {
  ListConnectionsResponse,
  ListContactGroupsResponse,
  Person,
  ContactGroup,
} from './types'
import type { GoogleContactsClientDeps } from './client'
import { GoogleContactsClient } from './client'

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

/** Build a minimal non-deleted Person stub. */
function makePerson(id: string): Person {
  return { resourceName: `people/${id}`, etag: `etag-${id}` }
}

/** Build a deleted Person stub. */
function makeDeletedPerson(id: string): Person {
  return { resourceName: `people/${id}`, etag: `etag-${id}`, metadata: { deleted: true } }
}

/** Build a ContactGroup stub. */
function makeGroup(id: string): ContactGroup {
  return { resourceName: `contactGroups/${id}`, etag: `g-etag-${id}`, name: `Group ${id}` }
}

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

type AppendInput = {
  runId: string
  event: string
  level?: 'info' | 'warn' | 'error'
  payload?: unknown
}

function makeLogger() {
  const calls: AppendInput[] = []
  return {
    append: vi.fn(async (input: AppendInput) => {
      calls.push(input)
    }),
    calls,
    // SyncLogRepo stubs — not exercised by fetcher
    listByRun: vi.fn(),
    listLatest: vi.fn(),
    listLatestByEvent: vi.fn(),
    latestConsentTs: vi.fn(),
    clear: vi.fn(),
  }
}

// ---------------------------------------------------------------------------
// Mock GoogleContactsClient factory
// ---------------------------------------------------------------------------

/**
 * Creates a stub GoogleContactsClient whose listConnections and listContactGroups
 * can be controlled via injected mock functions.
 */
function makeClient(
  listConnectionsFn: (
    opts: Parameters<GoogleContactsClient['listConnections']>[0],
  ) => Promise<ListConnectionsResponse>,
  listContactGroupsFn: () => Promise<ListContactGroupsResponse>,
): GoogleContactsClient {
  // Minimal tokenSource — never called since we override the instance methods
  const deps: GoogleContactsClientDeps = { tokenSource: async () => 'fake-token' }
  const client = new GoogleContactsClient(deps)
  // Override the methods directly on the instance
  client.listConnections = vi.fn(listConnectionsFn)
  client.listContactGroups = vi.fn(listContactGroupsFn)
  return client
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchAll', () => {
  const RUN_ID = 'run-test-001'

  // Case (a): single page, 3 connections, nextSyncToken set
  it('(a) single page — returns 3 persons and nextSyncToken', async () => {
    const persons = [makePerson('1'), makePerson('2'), makePerson('3')]
    const client = makeClient(
      async () => ({
        connections: persons,
        nextSyncToken: 'token-abc',
      }),
      async () => ({ contactGroups: [] }),
    )
    const logger = makeLogger()

    const result = await fetchAll({
      client,
      syncToken: null,
      runId: RUN_ID,
      logger,
    } as unknown as FetchAllDeps)

    expect(result.persons).toHaveLength(3)
    expect(result.nextSyncToken).toBe('token-abc')
    expect(result.deletedResourceNames).toHaveLength(0)
  })

  // Case (b): multi-page — 3 pages, accumulates all persons, log written per page
  it('(b) multi-page — accumulates all persons and logs each page', async () => {
    const pages: ListConnectionsResponse[] = [
      { connections: [makePerson('1'), makePerson('2')], nextPageToken: 'pt1' },
      { connections: [makePerson('3'), makePerson('4')], nextPageToken: 'pt2' },
      { connections: [makePerson('5')], nextSyncToken: 'final-token' },
    ]
    let pageIndex = 0
    const client = makeClient(
      async () => pages[pageIndex++]!,
      async () => ({ contactGroups: [] }),
    )
    const logger = makeLogger()

    const result = await fetchAll({
      client,
      syncToken: null,
      runId: RUN_ID,
      logger,
    } as unknown as FetchAllDeps)

    expect(result.persons).toHaveLength(5)
    // One log entry per page
    const pageLogs = logger.calls.filter((c) => c.event === 'fetch_page')
    expect(pageLogs).toHaveLength(3)
    expect(result.nextSyncToken).toBe('final-token')
  })

  // Case (c): requestSyncToken=true ONLY on first page when syncToken is null
  it('(c) requestSyncToken=true only on page 1 when syncToken is null', async () => {
    const capturedOpts: Array<Parameters<GoogleContactsClient['listConnections']>[0]> = []
    const pages: ListConnectionsResponse[] = [
      { connections: [makePerson('1')], nextPageToken: 'pt1' },
      { connections: [makePerson('2')], nextSyncToken: 'tok' },
    ]
    let idx = 0
    const client = makeClient(
      async (opts) => {
        capturedOpts.push(opts ?? {})
        return pages[idx++]!
      },
      async () => ({ contactGroups: [] }),
    )
    const logger = makeLogger()

    await fetchAll({
      client,
      syncToken: null,
      runId: RUN_ID,
      logger,
    } as unknown as FetchAllDeps)

    expect(capturedOpts[0]?.requestSyncToken).toBe(true)
    // Second page must NOT have requestSyncToken
    expect(capturedOpts[1]?.requestSyncToken).toBeUndefined()
  })

  // Case (d): syncToken provided — requestSyncToken NOT set; client receives syncToken
  it('(d) syncToken provided — requestSyncToken absent, syncToken forwarded', async () => {
    const capturedOpts: Array<Parameters<GoogleContactsClient['listConnections']>[0]> = []
    const client = makeClient(
      async (opts) => {
        capturedOpts.push(opts ?? {})
        return { connections: [makePerson('1')], nextSyncToken: 'new-tok' }
      },
      async () => ({ contactGroups: [] }),
    )
    const logger = makeLogger()

    await fetchAll({
      client,
      syncToken: 'existing-token',
      runId: RUN_ID,
      logger,
    } as unknown as FetchAllDeps)

    expect(capturedOpts[0]?.syncToken).toBe('existing-token')
    expect(capturedOpts[0]?.requestSyncToken).toBeUndefined()
  })

  // Case (e): deleted connection → goes to deletedResourceNames, NOT persons
  it('(e) deleted connection goes to deletedResourceNames', async () => {
    const client = makeClient(
      async () => ({
        connections: [makePerson('1'), makeDeletedPerson('2'), makePerson('3')],
        nextSyncToken: 'tok',
      }),
      async () => ({ contactGroups: [] }),
    )
    const logger = makeLogger()

    const result = await fetchAll({
      client,
      syncToken: 'some-token',
      runId: RUN_ID,
      logger,
    } as unknown as FetchAllDeps)

    expect(result.persons).toHaveLength(2)
    expect(result.deletedResourceNames).toEqual(['people/2'])
  })

  // Case (f): nextSyncToken propagates from the final page
  it('(f) nextSyncToken from final page is returned', async () => {
    const pages: ListConnectionsResponse[] = [
      { connections: [makePerson('1')], nextPageToken: 'pt1', nextSyncToken: 'intermediate' },
      { connections: [makePerson('2')], nextSyncToken: 'final-token' },
    ]
    let idx = 0
    const client = makeClient(
      async () => pages[idx++]!,
      async () => ({ contactGroups: [] }),
    )
    const logger = makeLogger()

    const result = await fetchAll({
      client,
      syncToken: null,
      runId: RUN_ID,
      logger,
    } as unknown as FetchAllDeps)

    expect(result.nextSyncToken).toBe('final-token')
  })

  // Case (g): 410 error → restart without syncToken; log records recovery
  it('(g) 410 error triggers restart and logs recovery warn', async () => {
    let callCount = 0
    const client = makeClient(
      async () => {
        callCount++
        if (callCount === 1) {
          throw new Error('People API listConnections failed: HTTP 410 Gone')
        }
        return { connections: [makePerson('1')], nextSyncToken: 'recovered-token' }
      },
      async () => ({ contactGroups: [] }),
    )
    const logger = makeLogger()

    const result = await fetchAll({
      client,
      syncToken: 'expired-token',
      runId: RUN_ID,
      logger,
    } as unknown as FetchAllDeps)

    expect(result.persons).toHaveLength(1)
    expect(result.nextSyncToken).toBe('recovered-token')

    const warnLogs = logger.calls.filter((c) => c.event === 'error' && c.level === 'warn')
    expect(warnLogs).toHaveLength(1)
    expect((warnLogs[0]?.payload as { message: string })?.message).toContain('410')
  })

  // Case (h): two 410 errors in a row → throws (no infinite loop)
  it('(h) two 410 errors throw — no infinite loop', async () => {
    const client = makeClient(
      async () => {
        throw new Error('People API listConnections failed: HTTP 410 Gone')
      },
      async () => ({ contactGroups: [] }),
    )
    const logger = makeLogger()

    await expect(
      fetchAll({
        client,
        syncToken: 'expired-token',
        runId: RUN_ID,
        logger,
      } as unknown as FetchAllDeps),
    ).rejects.toThrow()
  })

  // Case (i): listContactGroups called separately; result populates labels
  it('(i) listContactGroups called and labels populated', async () => {
    const groups = [makeGroup('friends'), makeGroup('family')]
    const client = makeClient(
      async () => ({ connections: [], nextSyncToken: 'tok' }),
      async () => ({ contactGroups: groups }),
    )
    const logger = makeLogger()

    const result = await fetchAll({
      client,
      syncToken: null,
      runId: RUN_ID,
      logger,
    } as unknown as FetchAllDeps)

    expect(result.labels).toHaveLength(2)
    expect(result.labels[0]?.resourceName).toBe('contactGroups/friends')
    expect(result.labels[1]?.resourceName).toBe('contactGroups/family')
    // Confirm listContactGroups was indeed called
    expect(client.listContactGroups).toHaveBeenCalledTimes(1)
  })
})
