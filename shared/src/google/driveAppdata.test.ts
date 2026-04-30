// Tests for the Google Drive appdata transport client.
// Uses injectable fetchImpl mock to verify HTTP calls without network access.
import { describe, expect, test, vi } from 'vitest'
import { makeDriveAppdataClient } from './driveAppdata'

// ---------------------------------------------------------------------------
// Helpers

type MockCall = { url: string; init: RequestInit | undefined }

/** Build a mock fetch that returns canned responses in order. */
function mockFetch(...responses: Response[]): typeof fetch {
  const calls: MockCall[] = []
  let idx = 0
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    // Store init as-is (may be undefined); TS exactOptionalPropertyTypes is satisfied
    // because MockCall.init is typed as `RequestInit | undefined`
    const call: MockCall = { url: String(url), init }
    calls.push(call)
    const resp = responses[idx++]
    if (resp === undefined) throw new Error('mockFetch: no more canned responses')
    return resp
  }) as unknown as typeof fetch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(fn as unknown as Record<string, unknown>).__calls = calls
  return fn
}

/** Extract recorded calls from a mock fetch. */
function getCalls(fn: typeof fetch): MockCall[] {
  return (fn as unknown as Record<string, unknown>)['__calls'] as MockCall[]
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, statusText: string): Response {
  return new Response(JSON.stringify({ error: statusText }), { status, statusText })
}

// ---------------------------------------------------------------------------
// findSyncFileId

describe('findSyncFileId', () => {
  test('returns the file id when API responds with a matching file', async () => {
    const fetch = mockFetch(jsonResponse({ files: [{ id: 'abc123', name: 'sync.json' }] }))
    const client = makeDriveAppdataClient(fetch)
    const id = await client.findSyncFileId('token-x', 'sync.json')
    expect(id).toBe('abc123')
  })

  test('returns null when API responds with empty files array', async () => {
    const fetch = mockFetch(jsonResponse({ files: [] }))
    const client = makeDriveAppdataClient(fetch)
    const id = await client.findSyncFileId('token-x', 'sync.json')
    expect(id).toBeNull()
  })

  test('URL-encodes the file name in q param and includes spaces=appDataFolder', async () => {
    const fetch = mockFetch(jsonResponse({ files: [] }))
    const client = makeDriveAppdataClient(fetch)
    await client.findSyncFileId('token-x', 'my sync file.json')
    const calls = getCalls(fetch)
    expect(calls[0]!.url).toContain('spaces=appDataFolder')
    // The name contains a space which must be encoded
    expect(calls[0]!.url).not.toContain(' ')
    expect(calls[0]!.url).toContain(encodeURIComponent("name='my sync file.json'"))
  })

  test('throws with status code in message on 401 response', async () => {
    const fetch = mockFetch(errorResponse(401, 'Unauthorized'))
    const client = makeDriveAppdataClient(fetch)
    await expect(client.findSyncFileId('bad-token', 'sync.json')).rejects.toThrow('401')
  })

  test('throws with status code in message on 500 response', async () => {
    const fetch = mockFetch(errorResponse(500, 'Internal Server Error'))
    const client = makeDriveAppdataClient(fetch)
    await expect(client.findSyncFileId('token-x', 'sync.json')).rejects.toThrow('500')
  })

  test('sets Authorization Bearer header', async () => {
    const fetch = mockFetch(jsonResponse({ files: [] }))
    const client = makeDriveAppdataClient(fetch)
    await client.findSyncFileId('my-access-token', 'sync.json')
    const calls = getCalls(fetch)
    const authHeader = (calls[0]!.init?.headers as Record<string, string> | undefined)?.[
      'Authorization'
    ]
    expect(authHeader).toBe('Bearer my-access-token')
  })
})

// ---------------------------------------------------------------------------
// uploadBundle

describe('uploadBundle', () => {
  test('POSTs to /upload/drive/v3/files with parents=[appDataFolder] when no existing file', async () => {
    // First call: findSyncFileId returns null (no existing file)
    // Second call: create new file
    const fetch = mockFetch(jsonResponse({ files: [] }), jsonResponse({ id: 'new-file-id' }))
    const client = makeDriveAppdataClient(fetch)
    await client.uploadBundle('token-x', 'sync.json', { version: 1 })
    const calls = getCalls(fetch)
    expect(calls[1]!.init?.method).toBe('POST')
    expect(calls[1]!.url).toContain('/upload/drive/v3/files')
    expect(calls[1]!.url).toContain('uploadType=multipart')
    // Body should contain appDataFolder as parent
    expect(String(calls[1]!.init?.body)).toContain('appDataFolder')
  })

  test('PATCHes with no parents when an existing file id is found', async () => {
    // First call: findSyncFileId returns existing id
    // Second call: patch existing file
    const fetch = mockFetch(
      jsonResponse({ files: [{ id: 'existing-id', name: 'sync.json' }] }),
      jsonResponse({ id: 'existing-id' }),
    )
    const client = makeDriveAppdataClient(fetch)
    await client.uploadBundle('token-x', 'sync.json', { version: 2 })
    const calls = getCalls(fetch)
    expect(calls[1]!.init?.method).toBe('PATCH')
    expect(calls[1]!.url).toContain('/upload/drive/v3/files/existing-id')
    // Body should NOT contain appDataFolder (no parents on PATCH)
    expect(String(calls[1]!.init?.body)).not.toContain('appDataFolder')
  })

  test('returns the fileId from the API response', async () => {
    const fetch = mockFetch(jsonResponse({ files: [] }), jsonResponse({ id: 'returned-id' }))
    const client = makeDriveAppdataClient(fetch)
    const id = await client.uploadBundle('token-x', 'sync.json', { data: 'hello' })
    expect(id).toBe('returned-id')
  })

  test('sets Authorization Bearer header on upload request', async () => {
    const fetch = mockFetch(jsonResponse({ files: [] }), jsonResponse({ id: 'file-id' }))
    const client = makeDriveAppdataClient(fetch)
    await client.uploadBundle('upload-token', 'sync.json', {})
    const calls = getCalls(fetch)
    const authHeader = (calls[1]!.init?.headers as Record<string, string> | undefined)?.[
      'Authorization'
    ]
    expect(authHeader).toBe('Bearer upload-token')
  })

  test('throws with status code in message on upload failure', async () => {
    const fetch = mockFetch(jsonResponse({ files: [] }), errorResponse(403, 'Forbidden'))
    const client = makeDriveAppdataClient(fetch)
    await expect(client.uploadBundle('token-x', 'sync.json', {})).rejects.toThrow('403')
  })
})

// ---------------------------------------------------------------------------
// downloadBundle

describe('downloadBundle', () => {
  test('parses JSON body and returns it as unknown', async () => {
    const payload = { contacts: [{ id: '1', name: 'Alice' }], version: 42 }
    const fetch = mockFetch(jsonResponse(payload))
    const client = makeDriveAppdataClient(fetch)
    const result = await client.downloadBundle('token-x', 'file-id-123')
    expect(result).toEqual(payload)
  })

  test('sets Authorization Bearer header', async () => {
    const fetch = mockFetch(jsonResponse({ data: 'ok' }))
    const client = makeDriveAppdataClient(fetch)
    await client.downloadBundle('dl-token', 'file-id-456')
    const calls = getCalls(fetch)
    const authHeader = (calls[0]!.init?.headers as Record<string, string> | undefined)?.[
      'Authorization'
    ]
    expect(authHeader).toBe('Bearer dl-token')
  })

  test('uses correct URL with alt=media', async () => {
    const fetch = mockFetch(jsonResponse({}))
    const client = makeDriveAppdataClient(fetch)
    await client.downloadBundle('token-x', 'file-id-789')
    const calls = getCalls(fetch)
    expect(calls[0]!.url).toContain('/drive/v3/files/file-id-789')
    expect(calls[0]!.url).toContain('alt=media')
  })

  test('throws with status code in message on download failure', async () => {
    const fetch = mockFetch(errorResponse(404, 'Not Found'))
    const client = makeDriveAppdataClient(fetch)
    await expect(client.downloadBundle('token-x', 'missing-id')).rejects.toThrow('404')
  })
})
