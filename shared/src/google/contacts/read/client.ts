// GoogleContactsClient — read-only client for Google People API v1.
// Wraps googleApiFetch (L2.1/L2.2/L2.3 guards) with typed methods for
// connections, individual persons, and contact groups.
//
// EDITING RULES:
// - RO-INVARIANT: L3.1 — only read methods are allowed on this class.
// - Do NOT add write methods (create, update, delete, batchUpdate, etc.).
// - Do NOT bypass googleApiFetch — all requests must go through it.
// - All comments must remain in English.

// RO-INVARIANT: L3.1 (read methods only)

import { googleApiFetch, type HttpAuditFn } from '../shared/google-api-fetch'
import type {
  Person,
  ContactGroup,
  ListConnectionsResponse,
  ListContactGroupsResponse,
} from './types'

/** Fields requested for every Person fetch — covers all read-phase fields. */
const PERSON_FIELDS =
  'names,nicknames,emailAddresses,phoneNumbers,addresses,organizations,' +
  'occupations,biographies,birthdays,events,relations,urls,imClients,' +
  'miscKeywords,memberships,photos,locales,userDefined,genders'

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
  /** Async supplier of a valid OAuth2 access token. */
  tokenSource: () => Promise<string>
  /** Optional audit callback forwarded to googleApiFetch (L2.3). */
  audit?: HttpAuditFn
  /** Injectable fetch implementation for testing. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch
}

/**
 * Read-only client for the Google People API.
 *
 * All four public methods are GET-only and pass through googleApiFetch,
 * which enforces the method whitelist (L2.1) and URL allowlist (L2.2).
 */
export class GoogleContactsClient {
  private readonly tokenSource: () => Promise<string>
  private readonly audit: HttpAuditFn | undefined
  private readonly fetchImpl: typeof fetch | undefined

  constructor(deps: GoogleContactsClientDeps) {
    this.tokenSource = deps.tokenSource
    this.audit = deps.audit
    this.fetchImpl = deps.fetchImpl
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
   * Lists connections (contacts) for the authenticated user.
   * Supports pagination via pageToken and incremental sync via syncToken.
   */
  async listConnections(opts: ListConnectionsOpts = {}): Promise<ListConnectionsResponse> {
    let url =
      `https://people.googleapis.com/v1/people/me/connections` +
      `?personFields=${PERSON_FIELDS}` +
      `&pageSize=${opts.pageSize ?? 100}`

    if (opts.pageToken !== undefined) {
      url += `&pageToken=${opts.pageToken}`
    }
    if (opts.syncToken !== undefined) {
      url += `&syncToken=${opts.syncToken}`
    }
    if (opts.requestSyncToken === true) {
      url += `&requestSyncToken=true`
    }

    const accessToken = await this.tokenSource()
    const response = await googleApiFetch(this.buildFetchOpts(url, accessToken))

    if (!response.ok) {
      throw new Error(
        `People API listConnections failed: HTTP ${response.status} ${response.statusText}`,
      )
    }

    return (await response.json()) as ListConnectionsResponse
  }

  /**
   * Fetches a single Person by resource name (e.g. "people/c12345678").
   */
  async getPerson(resourceName: string): Promise<Person> {
    const url =
      `https://people.googleapis.com/v1/${resourceName}` + `?personFields=${PERSON_FIELDS}`

    const accessToken = await this.tokenSource()
    const response = await googleApiFetch(this.buildFetchOpts(url, accessToken))

    if (!response.ok) {
      throw new Error(`People API getPerson failed: HTTP ${response.status} ${response.statusText}`)
    }

    return (await response.json()) as Person
  }

  /**
   * Lists contact groups for the authenticated user.
   */
  async listContactGroups(opts: ListContactGroupsOpts = {}): Promise<ListContactGroupsResponse> {
    let url = `https://people.googleapis.com/v1/contactGroups` + `?pageSize=${opts.pageSize ?? 100}`

    if (opts.pageToken !== undefined) {
      url += `&pageToken=${opts.pageToken}`
    }

    const accessToken = await this.tokenSource()
    const response = await googleApiFetch(this.buildFetchOpts(url, accessToken))

    if (!response.ok) {
      throw new Error(
        `People API listContactGroups failed: HTTP ${response.status} ${response.statusText}`,
      )
    }

    return (await response.json()) as ListContactGroupsResponse
  }

  /**
   * Fetches a single ContactGroup by resource name (e.g. "contactGroups/family").
   */
  async getContactGroup(resourceName: string): Promise<ContactGroup> {
    const url = `https://people.googleapis.com/v1/${resourceName}`

    const accessToken = await this.tokenSource()
    const response = await googleApiFetch(this.buildFetchOpts(url, accessToken))

    if (!response.ok) {
      throw new Error(
        `People API getContactGroup failed: HTTP ${response.status} ${response.statusText}`,
      )
    }

    return (await response.json()) as ContactGroup
  }
}
