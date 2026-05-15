// Tests for downloadPhoto — allowlist enforcement, timeout, size limit,
// SHA-256 hash computation, and retry on 429 / 5xx / network error.
//
// No DB, no real HTTP. All tests use a mock fetchImpl and a noop sleepFn
// (otherwise the 1s/2s/4s retry backoff would slow the suite to a crawl).
// All comments must remain in English.

import { describe, it, expect, vi } from 'vitest'
import {
  downloadPhoto,
  PhotoUrlNotAllowedError,
  PhotoTooLargeError,
  RateLimitedError,
} from './photo-fetch'

/** Noop sleep — keeps the suite fast despite real backoff [1s, 2s, 4s]. */
const noopSleep = (): Promise<void> => Promise.resolve()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock Response that streams the given bytes. */
function mockResponse(
  bytes: Uint8Array,
  opts: { status?: number; contentType?: string; contentLength?: number } = {},
): Response {
  const status = opts.status ?? 200
  const headers = new Headers()
  headers.set('content-type', opts.contentType ?? 'image/jpeg')
  if (opts.contentLength !== undefined) {
    headers.set('content-length', String(opts.contentLength))
  }

  // Build a minimal ReadableStream from the bytes.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })

  return new Response(stream, { status, headers })
}

/** Build a mock fetchImpl that returns the given Response. */
function makeFetch(response: Response) {
  return vi.fn().mockResolvedValue(response)
}

/** A known 4-byte payload for deterministic hash checks. */
const KNOWN_BYTES = new Uint8Array([0x01, 0x02, 0x03, 0x04])
// Pre-computed SHA-256 of [0x01, 0x02, 0x03, 0x04]
const KNOWN_HASH = '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a'

const VALID_URL = 'https://lh3.googleusercontent.com/photo.jpg'

// ---------------------------------------------------------------------------
// Allowlist tests
// ---------------------------------------------------------------------------

describe('downloadPhoto — allowlist', () => {
  it('rejects arbitrary domain', async () => {
    const fetchImpl = vi.fn()
    await expect(downloadPhoto('https://evil.com/photo.jpg', fetchImpl, noopSleep)).rejects.toThrow(
      PhotoUrlNotAllowedError,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows http:// scheme on a permitted host (allowlist is hostname-only)', async () => {
    // Our allowlist validates hostname only — not scheme. An http:// URL on an
    // allowed host passes the guard and proceeds to fetch (fetch itself may or may not
    // succeed depending on the environment). We verify the guard does NOT throw here.
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(KNOWN_BYTES))
    const result = await downloadPhoto(
      'http://lh3.googleusercontent.com/photo.jpg',
      fetchImpl,
      noopSleep,
    )
    expect(result.hash).toBe(KNOWN_HASH)
  })

  it('rejects non-parseable URL', async () => {
    const fetchImpl = vi.fn()
    await expect(downloadPhoto('not a url', fetchImpl, noopSleep)).rejects.toThrow(
      PhotoUrlNotAllowedError,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts lh3.googleusercontent.com', async () => {
    const fetchImpl = makeFetch(mockResponse(KNOWN_BYTES))
    const result = await downloadPhoto(VALID_URL, fetchImpl, noopSleep)
    expect(result.hash).toBe(KNOWN_HASH)
  })

  it('accepts lh4.googleusercontent.com', async () => {
    const fetchImpl = makeFetch(mockResponse(KNOWN_BYTES))
    const result = await downloadPhoto(
      'https://lh4.googleusercontent.com/p.jpg',
      fetchImpl,
      noopSleep,
    )
    expect(result.bytes).toEqual(KNOWN_BYTES)
  })

  it('accepts lh5 and lh6 hosts', async () => {
    for (const host of ['lh5.googleusercontent.com', 'lh6.googleusercontent.com']) {
      const fetchImpl = makeFetch(mockResponse(KNOWN_BYTES))
      const result = await downloadPhoto(`https://${host}/photo.jpg`, fetchImpl, noopSleep)
      expect(result.hash).toBe(KNOWN_HASH)
    }
  })
})

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

describe('downloadPhoto — hash', () => {
  it('returns correct SHA-256 hex for known payload', async () => {
    const fetchImpl = makeFetch(mockResponse(KNOWN_BYTES))
    const result = await downloadPhoto(VALID_URL, fetchImpl, noopSleep)
    expect(result.hash).toBe(KNOWN_HASH)
  })

  it('returns mime type from response header', async () => {
    const fetchImpl = makeFetch(mockResponse(KNOWN_BYTES, { contentType: 'image/png' }))
    const result = await downloadPhoto(VALID_URL, fetchImpl, noopSleep)
    expect(result.mime).toBe('image/png')
  })

  it('falls back to image/jpeg when content-type header is absent', async () => {
    // Build a response without content-type.
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(KNOWN_BYTES)
        c.close()
      },
    })
    const response = new Response(stream, { status: 200, headers: new Headers() })
    const fetchImpl = vi.fn().mockResolvedValue(response)
    const result = await downloadPhoto(VALID_URL, fetchImpl, noopSleep)
    expect(result.mime).toBe('image/jpeg')
  })
})

// ---------------------------------------------------------------------------
// Size limit
// ---------------------------------------------------------------------------

describe('downloadPhoto — size limit', () => {
  it('rejects via Content-Length header when over 5MB', async () => {
    const fetchImpl = makeFetch(mockResponse(KNOWN_BYTES, { contentLength: 6 * 1024 * 1024 }))
    await expect(downloadPhoto(VALID_URL, fetchImpl, noopSleep)).rejects.toThrow(PhotoTooLargeError)
  })

  it('rejects while streaming when accumulated bytes exceed 5MB', async () => {
    // Build a 5MB + 1 byte payload in two chunks.
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    const fetchImpl = makeFetch(mockResponse(big))
    await expect(downloadPhoto(VALID_URL, fetchImpl, noopSleep)).rejects.toThrow(PhotoTooLargeError)
  })

  it('accepts exactly at 5MB boundary', async () => {
    const exactly5mb = new Uint8Array(5 * 1024 * 1024)
    const fetchImpl = makeFetch(mockResponse(exactly5mb))
    const result = await downloadPhoto(VALID_URL, fetchImpl, noopSleep)
    expect(result.bytes.byteLength).toBe(5 * 1024 * 1024)
  })
})

// ---------------------------------------------------------------------------
// Retry on 429 / 5xx / network
// ---------------------------------------------------------------------------

describe('downloadPhoto — retry', () => {
  it('retries once on 5xx and succeeds', async () => {
    const failResponse = new Response(null, { status: 503 })
    const okResponse = mockResponse(KNOWN_BYTES)
    const fetchImpl = vi.fn().mockResolvedValueOnce(failResponse).mockResolvedValueOnce(okResponse)
    const result = await downloadPhoto(VALID_URL, fetchImpl, noopSleep)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.hash).toBe(KNOWN_HASH)
  })

  it('retries once on network error (TypeError) and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network failure'))
      .mockResolvedValueOnce(mockResponse(KNOWN_BYTES))
    const result = await downloadPhoto(VALID_URL, fetchImpl, noopSleep)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.hash).toBe(KNOWN_HASH)
  })

  it('retries on 429 and succeeds', async () => {
    const tooMany = new Response(null, { status: 429 })
    const ok = mockResponse(KNOWN_BYTES)
    const fetchImpl = vi.fn().mockResolvedValueOnce(tooMany).mockResolvedValueOnce(ok)
    const result = await downloadPhoto(VALID_URL, fetchImpl, noopSleep)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.hash).toBe(KNOWN_HASH)
  })

  it('honors Retry-After (delta-seconds) on 429', async () => {
    const tooMany = new Response(null, {
      status: 429,
      headers: new Headers({ 'retry-after': '2' }),
    })
    const ok = mockResponse(KNOWN_BYTES)
    const fetchImpl = vi.fn().mockResolvedValueOnce(tooMany).mockResolvedValueOnce(ok)
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const result = await downloadPhoto(VALID_URL, fetchImpl, sleepFn)
    expect(result.hash).toBe(KNOWN_HASH)
    // First (and only) backoff between attempt-0 and attempt-1: 2 seconds.
    expect(sleepFn).toHaveBeenCalledTimes(1)
    expect(sleepFn).toHaveBeenCalledWith(2000)
  })

  it('caps Retry-After at MAX_RETRY_AFTER_MS (10s)', async () => {
    const tooMany = new Response(null, {
      status: 429,
      headers: new Headers({ 'retry-after': '999' }),
    })
    const ok = mockResponse(KNOWN_BYTES)
    const fetchImpl = vi.fn().mockResolvedValueOnce(tooMany).mockResolvedValueOnce(ok)
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    await downloadPhoto(VALID_URL, fetchImpl, sleepFn)
    expect(sleepFn).toHaveBeenCalledWith(10_000)
  })

  it('falls back to exponential backoff when 429 has no Retry-After', async () => {
    const tooMany = new Response(null, { status: 429 })
    const ok = mockResponse(KNOWN_BYTES)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tooMany)
      .mockResolvedValueOnce(tooMany)
      .mockResolvedValueOnce(ok)
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    await downloadPhoto(VALID_URL, fetchImpl, sleepFn)
    expect(sleepFn).toHaveBeenNthCalledWith(1, 1000)
    expect(sleepFn).toHaveBeenNthCalledWith(2, 2000)
  })

  it('throws RateLimitedError after exhausting all 4 attempts on 429', async () => {
    const tooMany = new Response(null, { status: 429 })
    const fetchImpl = vi.fn().mockResolvedValue(tooMany)
    await expect(downloadPhoto(VALID_URL, fetchImpl, noopSleep)).rejects.toThrow(RateLimitedError)
    // 1 initial + 3 retries = 4 attempts.
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('maxRetries=0 → single attempt; 429 throws immediately (no retry)', async () => {
    const tooMany = new Response(null, { status: 429 })
    const fetchImpl = vi.fn().mockResolvedValue(tooMany)
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    await expect(downloadPhoto(VALID_URL, fetchImpl, sleepFn, 0)).rejects.toThrow(RateLimitedError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('maxRetries=0 → single attempt; 5xx throws immediately', async () => {
    const fail = new Response(null, { status: 503 })
    const fetchImpl = vi.fn().mockResolvedValue(fail)
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    await expect(downloadPhoto(VALID_URL, fetchImpl, sleepFn, 0)).rejects.toThrow(
      /Photo fetch HTTP 5/,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('throws after four consecutive 5xx responses', async () => {
    const fail = (): Response => new Response(null, { status: 503 })
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(fail())
    await expect(downloadPhoto(VALID_URL, fetchImpl, noopSleep)).rejects.toThrow(
      /Photo fetch HTTP 5/,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('does NOT retry on PhotoTooLargeError', async () => {
    const big = new Uint8Array(6 * 1024 * 1024)
    const fetchImpl = makeFetch(mockResponse(big))
    await expect(downloadPhoto(VALID_URL, fetchImpl, noopSleep)).rejects.toThrow(PhotoTooLargeError)
    // Only one attempt — no retry for size errors.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    await expect(downloadPhoto(VALID_URL, fetchImpl, noopSleep)).rejects.toThrow(
      /Photo fetch HTTP 404/,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
