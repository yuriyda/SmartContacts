// Tests for GoogleContactsClient — verifies all four read methods, auth header,
// audit callback, error handling on non-ok responses, URL encoding via URLSearchParams,
// and retry logic (401 token refresh; 429/5xx exponential backoff).
//
// EDITING RULES:
// - Tests must remain read-only; do NOT add tests for write operations.
// - All comments must remain in English.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GoogleContactsClient } from './client'
import type { HttpAuditFn } from '../shared/google-api-fetch'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Builds a minimal fetch mock that returns a successful JSON response. */
function makeFetchMock(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(body),
  } satisfies Partial<Response> as unknown as Response)
}

/** Builds a fetch mock that returns different responses on successive calls. */
function makeSequentialFetchMock(responses: Array<{ status: number; body?: unknown }>) {
  let call = 0
  return vi.fn().mockImplementation(() => {
    const r = responses[call] ?? responses[responses.length - 1]!
    call++
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: r.status === 200 ? 'OK' : 'Error',
      json: vi.fn().mockResolvedValue(r.body ?? {}),
    } as unknown as Response)
  })
}

const ACCESS_TOKEN = 'test-access-token-abc'
const REFRESHED_TOKEN = 'test-refreshed-token-xyz'

function makeTokenSource() {
  return vi.fn().mockResolvedValue(ACCESS_TOKEN)
}

/** No-op sleep for tests (avoids real delays). */
const noopSleep = vi.fn().mockResolvedValue(undefined)

// The fixed personFields string the client must use (miscKeywords removed).
const PERSON_FIELDS =
  'names,nicknames,emailAddresses,phoneNumbers,addresses,organizations,' +
  'occupations,biographies,birthdays,events,relations,urls,imClients,' +
  'memberships,photos,locales,userDefined,genders'

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GoogleContactsClient', () => {
  let fetchMock: ReturnType<typeof makeFetchMock>
  let tokenSource: ReturnType<typeof makeTokenSource>
  let client: GoogleContactsClient

  beforeEach(() => {
    fetchMock = makeFetchMock({})
    tokenSource = makeTokenSource()
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })
  })

  // Case a: listConnections() makes GET to expected base URL with Bearer auth
  it('(a) listConnections() calls GET on the connections URL with Bearer auth', async () => {
    fetchMock = makeFetchMock({ connections: [] })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await client.listConnections()

    expect(fetchMock).toHaveBeenCalledOnce()
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(calledUrl).toContain('https://people.googleapis.com/v1/people/me/connections')
    expect(calledUrl).toContain('personFields=')
    expect(calledUrl).toContain('pageSize=100')
    expect(calledInit.method).toBe('GET')
    const headers = calledInit.headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`)
  })

  // Case b: listConnections({ pageToken: 'xyz' }) includes &pageToken=xyz
  it('(b) listConnections({ pageToken }) appends pageToken to URL', async () => {
    fetchMock = makeFetchMock({ connections: [] })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await client.listConnections({ pageToken: 'xyz' })

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    expect(calledUrl).toContain('pageToken=xyz')
  })

  // Case c: listConnections({ requestSyncToken: true }) includes &requestSyncToken=true
  it('(c) listConnections({ requestSyncToken: true }) appends requestSyncToken param', async () => {
    fetchMock = makeFetchMock({ connections: [] })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await client.listConnections({ requestSyncToken: true })

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    expect(calledUrl).toContain('requestSyncToken=true')
  })

  // Case d: getPerson('people/c123') GETs .../v1/people/c123?personFields=...
  it('(d) getPerson() calls GET on the correct person URL with personFields', async () => {
    fetchMock = makeFetchMock({ resourceName: 'people/c123' })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await client.getPerson('people/c123')

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    expect(calledUrl).toContain('https://people.googleapis.com/v1/people/c123')
    expect(calledUrl).toContain('personFields=')
  })

  // Case e: listContactGroups() GETs .../v1/contactGroups?pageSize=100
  it('(e) listContactGroups() calls GET on contactGroups URL with pageSize=100', async () => {
    fetchMock = makeFetchMock({ contactGroups: [] })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await client.listContactGroups()

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    expect(calledUrl).toContain('https://people.googleapis.com/v1/contactGroups')
    expect(calledUrl).toContain('pageSize=100')
  })

  // Case f: getContactGroup('contactGroups/family') GETs .../v1/contactGroups/family
  it('(f) getContactGroup() calls GET on the correct group resource URL', async () => {
    fetchMock = makeFetchMock({ resourceName: 'contactGroups/family', etag: 'e1', name: 'Family' })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await client.getContactGroup('contactGroups/family')

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    expect(calledUrl).toBe('https://people.googleapis.com/v1/contactGroups/family')
  })

  // Case g: tokenSource() result is used as Bearer token in Authorization header
  it('(g) uses the token from tokenSource as the Authorization Bearer token', async () => {
    const customToken = 'my-custom-token-xyz'
    const customTokenSource = vi.fn().mockResolvedValue(customToken)
    fetchMock = makeFetchMock({})
    client = new GoogleContactsClient({
      tokenSource: customTokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await client.listConnections()

    const [, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = calledInit.headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Bearer ${customToken}`)
  })

  // Case h: audit callback receives an http_call-shape entry
  it('(h) audit callback is called with method, url, status, durationMs', async () => {
    const auditEntries: Parameters<HttpAuditFn>[0][] = []
    const audit: HttpAuditFn = (entry) => {
      auditEntries.push(entry)
    }
    fetchMock = makeFetchMock({ connections: [] })
    client = new GoogleContactsClient({
      tokenSource,
      audit,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await client.listConnections()

    expect(auditEntries).toHaveLength(1)
    const entry = auditEntries[0]!
    expect(entry.method).toBe('GET')
    expect(entry.url).toContain('people/me/connections')
    expect(entry.status).toBe(200)
    expect(typeof entry.durationMs).toBe('number')
  })

  // Case i: non-ok response causes method to throw Error with status code
  it('(i) throws Error with status code when response.ok is false (404)', async () => {
    fetchMock = makeFetchMock({ error: 'Not Found' }, 404)
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await expect(client.listConnections()).rejects.toThrow('404')
  })

  // ---------------------------------------------------------------------------
  // Case j: PERSON_FIELDS does NOT include miscKeywords
  // ---------------------------------------------------------------------------
  it('(j) PERSON_FIELDS does not include miscKeywords', async () => {
    fetchMock = makeFetchMock({ connections: [] })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await client.listConnections()

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    expect(calledUrl).not.toContain('miscKeywords')
  })

  // Case k: PERSON_FIELDS includes birthdays and relations
  it('(k) PERSON_FIELDS includes birthdays and relations', async () => {
    fetchMock = makeFetchMock({ connections: [] })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await client.listConnections()

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    // Decode URL to check actual param value
    const urlObj = new URL(calledUrl)
    const pf = urlObj.searchParams.get('personFields') ?? ''
    expect(pf).toContain('birthdays')
    expect(pf).toContain('relations')
    expect(pf).toBe(PERSON_FIELDS)
  })

  // ---------------------------------------------------------------------------
  // Case l: URLSearchParams encodes special characters in pageToken
  // ---------------------------------------------------------------------------
  it('(l) pageToken with special chars (&, =, +, /) is properly URL-encoded', async () => {
    fetchMock = makeFetchMock({ connections: [] })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    const specialToken = 'abc&def=ghi+jkl/mno'
    await client.listConnections({ pageToken: specialToken })

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    // The raw special chars must NOT appear literally in the URL
    expect(calledUrl).not.toContain('abc&def=ghi+jkl/mno')
    // URLSearchParams-encoded value must be present (% encoding)
    const urlObj = new URL(calledUrl)
    expect(urlObj.searchParams.get('pageToken')).toBe(specialToken)
  })

  // Case l2: syncToken with special chars
  it('(l2) syncToken with special chars is properly URL-encoded', async () => {
    fetchMock = makeFetchMock({ connections: [] })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    const specialToken = 'tok=en&val+ue/here'
    await client.listConnections({ syncToken: specialToken })

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    const urlObj = new URL(calledUrl)
    expect(urlObj.searchParams.get('syncToken')).toBe(specialToken)
  })

  // ---------------------------------------------------------------------------
  // Case m: HTTP 401 once → retry with refreshed token → success
  // ---------------------------------------------------------------------------
  it('(m) HTTP 401 on first call → retries with forceRefresh=true → succeeds', async () => {
    const seqFetch = makeSequentialFetchMock([
      { status: 401 },
      { status: 200, body: { connections: [] } },
    ])
    const tokenSourceSpy = vi
      .fn()
      .mockResolvedValueOnce(ACCESS_TOKEN) // initial call
      .mockResolvedValueOnce(REFRESHED_TOKEN) // forceRefresh call

    client = new GoogleContactsClient({
      tokenSource: tokenSourceSpy,
      fetchImpl: seqFetch as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    const result = await client.listConnections()
    expect(result).toEqual({ connections: [] })

    // tokenSource called twice: once normal, once with forceRefresh=true
    expect(tokenSourceSpy).toHaveBeenCalledTimes(2)
    expect(tokenSourceSpy.mock.calls[1]![0]).toBe(true)

    // fetch called twice
    expect(seqFetch).toHaveBeenCalledTimes(2)
    // Second call uses refreshed token
    const [, secondInit] = seqFetch.mock.calls[1] as [string, RequestInit]
    expect((secondInit.headers as Record<string, string>)['Authorization']).toBe(
      `Bearer ${REFRESHED_TOKEN}`,
    )
  })

  // Case n: HTTP 401 twice → throws
  it('(n) HTTP 401 on both calls → throws Unauthorized error', async () => {
    const seqFetch = makeSequentialFetchMock([{ status: 401 }, { status: 401 }])
    const tokenSourceSpy = vi
      .fn()
      .mockResolvedValueOnce(ACCESS_TOKEN)
      .mockResolvedValueOnce(REFRESHED_TOKEN)

    client = new GoogleContactsClient({
      tokenSource: tokenSourceSpy,
      fetchImpl: seqFetch as unknown as typeof fetch,
      sleepFn: noopSleep,
    })

    await expect(client.listConnections()).rejects.toThrow('401')
    expect(seqFetch).toHaveBeenCalledTimes(2)
  })

  // Case o: HTTP 429 → backoff → eventual success
  it('(o) HTTP 429 → waits → retries → succeeds on third call', async () => {
    const seqFetch = makeSequentialFetchMock([
      { status: 429 },
      { status: 429 },
      { status: 200, body: { connections: ['a'] } },
    ])

    const sleepSpy = vi.fn().mockResolvedValue(undefined)
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: seqFetch as unknown as typeof fetch,
      sleepFn: sleepSpy,
    })

    const result = await client.listConnections()
    expect(result).toEqual({ connections: ['a'] })

    // fetch: initial + 2 retry attempts = 3 total
    expect(seqFetch).toHaveBeenCalledTimes(3)
    // sleep called twice (once per 429 before retry)
    expect(sleepSpy).toHaveBeenCalledTimes(2)
    // First backoff = 1000ms, second = 2000ms
    expect(sleepSpy.mock.calls[0]![0]).toBe(1000)
    expect(sleepSpy.mock.calls[1]![0]).toBe(2000)
  })

  // Case p: HTTP 500 → max retries → throws
  it('(p) HTTP 500 → all 4 retries exhausted → throws', async () => {
    const seqFetch = makeSequentialFetchMock([
      { status: 500 },
      { status: 500 },
      { status: 500 },
      { status: 500 },
      { status: 500 },
    ])

    const sleepSpy = vi.fn().mockResolvedValue(undefined)
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: seqFetch as unknown as typeof fetch,
      sleepFn: sleepSpy,
    })

    await expect(client.listConnections()).rejects.toThrow('500')
    // initial call + 4 retries = 5 calls
    expect(seqFetch).toHaveBeenCalledTimes(5)
    // 4 backoff sleeps
    expect(sleepSpy).toHaveBeenCalledTimes(4)
  })
})
