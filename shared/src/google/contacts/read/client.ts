// GoogleContactsClient — read-only client for Google People API v1.
// Wraps googleApiFetch (L2.1/L2.2/L2.3 guards) with typed methods for
// connections, individual persons, and contact groups.
//
// EDITING RULES:
// - RO-INVARIANT: L3.1 — only read methods are allowed on this class.
// - Do NOT add write methods (create, update, delete, batchUpdate, etc.).
// - Do NOT bypass googleApiFetch — all requests must go through it.
// - All comments must remain in English.
// - URL construction MUST use the URL + URLSearchParams APIs (never string concat).
// - Retry policy: 401 → one retry (fresh token); 429/5xx → exponential backoff.
//
// Not mapped: Google's miscKeywords are Outlook-import artifacts with no natural
// slot in Contact; dropped from PERSON_FIELDS to avoid silent data discard.

// RO-INVARIANT: L3.1 (read methods only)

import { googleApiFetch, type HttpAuditFn } from '../shared/google-api-fetch'
import type {
  Person,
  ContactGroup,
  ListConnectionsResponse,
  ListContactGroupsResponse,
} from './types'

/** Fields requested for every Person fetch — covers all mapped read-phase fields. */
const PERSON_FIELDS =
  'names,nicknames,emailAddresses,phoneNumbers,addresses,organizations,' +
  'occupations,biographies,birthdays,events,relations,urls,imClients,' +
  'memberships,photos,locales,userDefined,genders'

/** Delays (ms) for exponential backoff on 429/5xx: 4 retries max. */
const BACKOFF_DELAYS_MS = [1000, 2000, 4000, 8000]

/** Options for listConnections. */
export interface ListConnectionsOpts {
  pageToken?: string
  syncToken?: string
  pageSize?: number
  requestSyncToken?: boolean
}

/** Options for listContactGroups. */
export interface ListContactGroupsOpts {
  pageToken?: string
  pageSize?: number
}

/** Constructor dependencies for GoogleContactsClient. */
export interface GoogleContactsClientDeps {
  /** Async supplier of a valid OAuth2 access token. Pass forceRefresh=true to bypass cache. */
  tokenSource: (forceRefresh?: boolean) => Promise<string>
  /** Optional audit callback forwarded to googleApiFetch (L2.3). */
  audit?: HttpAuditFn
  /** Injectable fetch implementation for testing. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch
  /** Injectable sleep function for testing (defaults to setTimeout-based sleep). */
  sleepFn?: (ms: number) => Promise<void>
}

/**
 * Read-only client for the Google People API.
 *
 * All four public methods are GET-only and pass through googleApiFetch,
 * which enforces the method whitelist (L2.1) and URL allowlist (L2.2).
 *
 * Retry policy (§9.1):
 *  - HTTP 401: one retry with forceRefresh=true on tokenSource; throw on second 401.
 *  - HTTP 429 or 5xx: exponential backoff [1s, 2s, 4s, 8s]; throw after 4 retries.
 *  - Other non-ok: throw immediately.
 */
export class GoogleContactsClient {
  private readonly tokenSource: (forceRefresh?: boolean) => Promise<string>
  private readonly audit: HttpAuditFn | undefined
  private readonly fetchImpl: typeof fetch | undefined
  private readonly sleepFn: (ms: number) => Promise<void>

  constructor(deps: GoogleContactsClientDeps) {
    this.tokenSource = deps.tokenSource
    this.audit = deps.audit
    this.fetchImpl = deps.fetchImpl
    this.sleepFn = deps.sleepFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  /** Builds the GoogleApiFetchOptions with optional fields excluded when undefined (exactOptionalPropertyTypes). */
  private buildFetchOpts(url: string, accessToken: string): Parameters<typeof googleApiFetch>[0] {
    const opts: Parameters<typeof googleApiFetch>[0] = {
      method: 'GET',
      url,
      headers: { Authorization: `Bearer ${accessToken}` },
    }
    if (this.audit !== undefined) opts.audit = this.audit
    if (this.fetchImpl !== undefined) opts.fetchImpl = this.fetchImpl
    return opts
  }

  /**
   * Internal fetch with retry logic.
   *  - 401: refresh token once, retry; throw on second 401.
   *  - 429 / 5xx: exponential backoff up to 4 retries; throw after exhausted.
   *  - Other non-ok: throw immediately.
   */
  private async fetchWithRetry(buildUrl: () => string): Promise<Response> {
    // --- 401 retry: try once with fresh token ---
    let accessToken = await this.tokenSource()
    let response = await googleApiFetch(this.buildFetchOpts(buildUrl(), accessToken))

    if (response.status === 401) {
      // Refresh token and retry once
      accessToken = await this.tokenSource(true)
      response = await googleApiFetch(this.buildFetchOpts(buildUrl(), accessToken))
      if (response.status === 401) {
        throw new Error(`People API request failed: HTTP 401 Unauthorized (after token refresh)`)
      }
    }

    // --- 429 / 5xx backoff ---
    let attempt = 0
    while (
      (response.status === 429 || response.status >= 500) &&
      attempt < BACKOFF_DELAYS_MS.length
    ) {
      await this.sleepFn(BACKOFF_DELAYS_MS[attempt]!)
      attempt++
      response = await googleApiFetch(this.buildFetchOpts(buildUrl(), accessToken))
    }

    if (!response.ok) {
      throw new Error(`People API request failed: HTTP ${response.status} ${response.statusText}`)
    }

    return response
  }

  /**
   * Lists connections (contacts) for the authenticated user.
   * Supports pagination via pageToken and incremental sync via syncToken.
   */
  async listConnections(opts: ListConnectionsOpts = {}): Promise<ListConnectionsResponse> {
    const buildUrl = (): string => {
      const url = new URL('https://people.googleapis.com/v1/people/me/connections')
      url.searchParams.set('personFields', PERSON_FIELDS)
      url.searchParams.set('pageSize', String(opts.pageSize ?? 100))
      if (opts.pageToken !== undefined) url.searchParams.set('pageToken', opts.pageToken)
      if (opts.syncToken !== undefined) url.searchParams.set('syncToken', opts.syncToken)
      if (opts.requestSyncToken === true) url.searchParams.set('requestSyncToken', 'true')
      return url.toString()
    }

    const response = await this.fetchWithRetry(buildUrl)
    return (await response.json()) as ListConnectionsResponse
  }

  /**
   * Fetches a single Person by resource name (e.g. "people/c12345678").
   */
  async getPerson(resourceName: string): Promise<Person> {
    const buildUrl = (): string => {
      const url = new URL(`https://people.googleapis.com/v1/${resourceName}`)
      url.searchParams.set('personFields', PERSON_FIELDS)
      return url.toString()
    }

    const response = await this.fetchWithRetry(buildUrl)
    return (await response.json()) as Person
  }

  /**
   * Lists contact groups for the authenticated user.
   */
  async listContactGroups(opts: ListContactGroupsOpts = {}): Promise<ListContactGroupsResponse> {
    const buildUrl = (): string => {
      const url = new URL('https://people.googleapis.com/v1/contactGroups')
      url.searchParams.set('pageSize', String(opts.pageSize ?? 100))
      if (opts.pageToken !== undefined) url.searchParams.set('pageToken', opts.pageToken)
      return url.toString()
    }

    const response = await this.fetchWithRetry(buildUrl)
    return (await response.json()) as ListContactGroupsResponse
  }

  /**
   * Fetches a single ContactGroup by resource name (e.g. "contactGroups/family").
   */
  async getContactGroup(resourceName: string): Promise<ContactGroup> {
    const buildUrl = (): string => `https://people.googleapis.com/v1/${resourceName}`

    const response = await this.fetchWithRetry(buildUrl)
    return (await response.json()) as ContactGroup
  }
}
