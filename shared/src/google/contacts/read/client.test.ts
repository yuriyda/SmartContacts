// Tests for GoogleContactsClient — verifies all four read methods, auth header,
// audit callback, and error handling on non-ok responses.
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

const ACCESS_TOKEN = 'test-access-token-abc'

function makeTokenSource() {
  return vi.fn().mockResolvedValue(ACCESS_TOKEN)
}

// The fixed personFields string the client must use.
const PERSON_FIELDS =
  'names,nicknames,emailAddresses,phoneNumbers,addresses,organizations,' +
  'occupations,biographies,birthdays,events,relations,urls,imClients,' +
  'miscKeywords,memberships,photos,locales,userDefined,genders'

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
    })
  })

  // Case a: listConnections() makes GET to expected base URL with Bearer auth
  it('(a) listConnections() calls GET on the connections URL with Bearer auth', async () => {
    fetchMock = makeFetchMock({ connections: [] })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    await client.listConnections()

    expect(fetchMock).toHaveBeenCalledOnce()
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(calledUrl).toContain('https://people.googleapis.com/v1/people/me/connections')
    expect(calledUrl).toContain(
      `personFields=${encodeURIComponent(PERSON_FIELDS).replace(/%2C/gi, ',').replace(/%2C/g, ',')}`.split(
        '?',
      )[0] ?? '',
    )
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
    })

    await client.listConnections({ pageToken: 'xyz' })

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    expect(calledUrl).toContain('&pageToken=xyz')
  })

  // Case c: listConnections({ requestSyncToken: true }) includes &requestSyncToken=true
  it('(c) listConnections({ requestSyncToken: true }) appends requestSyncToken param', async () => {
    fetchMock = makeFetchMock({ connections: [] })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    await client.listConnections({ requestSyncToken: true })

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    expect(calledUrl).toContain('&requestSyncToken=true')
  })

  // Case d: getPerson('people/c123') GETs .../v1/people/c123?personFields=...
  it('(d) getPerson() calls GET on the correct person URL with personFields', async () => {
    fetchMock = makeFetchMock({ resourceName: 'people/c123' })
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
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
  it('(i) throws Error with status code when response.ok is false (401)', async () => {
    fetchMock = makeFetchMock({ error: 'Unauthorized' }, 401)
    client = new GoogleContactsClient({
      tokenSource,
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    await expect(client.listConnections()).rejects.toThrow('401')
  })
})
