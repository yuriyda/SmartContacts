// RO-INVARIANT: L2.3 (logs each fetch_page). Uses client only — no DB writes outside the injected SyncLogRepo.
//
// fetchAll — paginates through all Google Contacts connections and contact groups
// for a single sync run. Handles syncToken-based incremental sync, deletion markers,
// and automatic recovery from HTTP 410 (token expiry) with a single retry.
//
// Rules:
//  - No `any` types.
//  - Do NOT add write methods or import DB adapters directly.
//  - All 410-recovery is limited to one restart per call to prevent infinite loops.
//  - All comments must remain in English.

import type { GoogleContactsClient } from './client'
import type { Person, ContactGroup } from './types'
import type { SyncLogRepo } from './sync-log-repo'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FetchResult {
  /** All non-deleted persons fetched this run. */
  persons: Person[]
  /** Resource names from connections with metadata.deleted === true (incremental sync only). */
  deletedResourceNames: string[]
  /** All contact groups fetched this run. */
  labels: ContactGroup[]
  /** syncToken from the last connections page, or null if API did not return one. */
  nextSyncToken: string | null
}

export interface FetchAllDeps {
  client: GoogleContactsClient
  syncToken: string | null
  runId: string
  logger: SyncLogRepo
  /** Default: 100 */
  pageSize?: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Error shape thrown when a page returns HTTP 410 (sync token expired). */
class SyncTokenExpiredError extends Error {
  constructor() {
    super('Sync token expired (HTTP 410)')
    this.name = 'SyncTokenExpiredError'
  }
}

/**
 * Fetches all connections pages for one run, accumulating persons and deleted resource names.
 * Throws SyncTokenExpiredError if a 410 is encountered.
 */
async function fetchConnectionPages(
  deps: FetchAllDeps,
  useSyncToken: boolean,
): Promise<{ persons: Person[]; deletedResourceNames: string[]; nextSyncToken: string | null }> {
  const { client, runId, logger } = deps
  const pageSize = deps.pageSize ?? 100
  const effectiveSyncToken = useSyncToken ? (deps.syncToken ?? undefined) : undefined

  const persons: Person[] = []
  const deletedResourceNames: string[] = []
  let nextSyncToken: string | null = null
  let pageToken: string | undefined = undefined
  let pageNumber = 0
  // requestSyncToken only on the very first page of a full (non-incremental) fetch
  const isFullFetch = !useSyncToken || deps.syncToken == null

  do {
    pageNumber++

    let response
    try {
      const opts: Parameters<GoogleContactsClient['listConnections']>[0] = { pageSize }
      if (pageToken !== undefined) opts.pageToken = pageToken
      if (effectiveSyncToken !== undefined) opts.syncToken = effectiveSyncToken
      if (isFullFetch && pageNumber === 1) opts.requestSyncToken = true
      response = await client.listConnections(opts)
    } catch (err) {
      // Re-detect HTTP 410 from error message thrown by client
      if (err instanceof Error && err.message.includes('HTTP 410')) {
        throw new SyncTokenExpiredError()
      }
      throw err
    }

    const connections = response.connections ?? []

    for (const person of connections) {
      if (person.metadata?.deleted === true) {
        if (person.resourceName !== undefined) {
          deletedResourceNames.push(person.resourceName)
        }
      } else {
        persons.push(person)
      }
    }

    if (response.nextSyncToken !== undefined) {
      nextSyncToken = response.nextSyncToken
    }

    await logger.append({
      runId,
      event: 'fetch_page',
      payload: {
        pageNumber,
        fetched: connections.length,
        nextPageToken: response.nextPageToken ?? null,
      },
    })

    pageToken = response.nextPageToken
  } while (pageToken !== undefined)

  return { persons, deletedResourceNames, nextSyncToken }
}

/**
 * Fetches all contact group pages.
 */
async function fetchAllLabels(
  client: GoogleContactsClient,
  pageSize: number,
): Promise<ContactGroup[]> {
  const labels: ContactGroup[] = []
  let pageToken: string | undefined = undefined

  do {
    const opts: Parameters<GoogleContactsClient['listContactGroups']>[0] = { pageSize }
    if (pageToken !== undefined) opts.pageToken = pageToken
    const response = await client.listContactGroups(opts)
    const groups = response.contactGroups ?? []
    labels.push(...groups)
    pageToken = response.nextPageToken
  } while (pageToken !== undefined)

  return labels
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches all contacts and contact groups for one sync run.
 *
 * - Pages through listConnections until exhausted.
 * - Separates deleted markers (metadata.deleted === true) into deletedResourceNames.
 * - On HTTP 410 (sync token expired): logs a warn event and restarts from scratch without syncToken.
 *   Only one restart is allowed per call; a second 410 throws.
 * - Pages through listContactGroups to collect labels.
 */
export async function fetchAll(deps: FetchAllDeps): Promise<FetchResult> {
  const { runId, logger } = deps
  const pageSize = deps.pageSize ?? 100

  // Attempt connections fetch; allow one recovery from 410
  let connectionsResult: {
    persons: Person[]
    deletedResourceNames: string[]
    nextSyncToken: string | null
  }
  const hasSyncToken = deps.syncToken != null

  try {
    connectionsResult = await fetchConnectionPages(deps, hasSyncToken)
  } catch (err) {
    if (err instanceof SyncTokenExpiredError) {
      // Log recovery event
      await logger.append({
        runId,
        event: 'error',
        level: 'warn',
        payload: { message: 'syncToken expired (HTTP 410), restarting full fetch' },
      })
      // Retry once without sync token — throws if 410 again
      connectionsResult = await fetchConnectionPages(deps, false)
    } else {
      throw err
    }
  }

  const labels = await fetchAllLabels(deps.client, pageSize)

  return {
    persons: connectionsResult.persons,
    deletedResourceNames: connectionsResult.deletedResourceNames,
    labels,
    nextSyncToken: connectionsResult.nextSyncToken,
  }
}
