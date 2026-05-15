// photo-fetch.ts — Downloads a Google CDN avatar photo and returns its bytes, MIME type, and SHA-256 hash.
//
// EDITING RULES:
//  - Do NOT use googleApiFetch here; that helper is for People API calls only.
//  - Only hosts in GOOGLE_CDN_HOSTS are allowed — throws PhotoUrlNotAllowedError for others.
//  - Enforce 10s timeout and 5MB max size.
//  - Retry policy: up to 3 retries on 429 / 5xx / network error with backoff
//    [1s, 2s, 4s]; honor Retry-After header on 429 (capped at 10s).
//    Non-retryable: PhotoUrlNotAllowedError, PhotoTooLargeError, 4xx ≠ 429.
//  - All comments must remain in English.
//  - No `any` types.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOOGLE_CDN_HOSTS: ReadonlySet<string> = new Set([
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
])

const PHOTO_TIMEOUT_MS = 10_000
const PHOTO_MAX_BYTES = 5 * 1024 * 1024 // 5 MB

/** Exponential backoff (ms) applied when 429/5xx/network errors are retried. */
const RETRY_BACKOFF_MS: readonly number[] = [1000, 2000, 4000]
/** Hard cap on server-provided Retry-After to avoid stalling for minutes. */
const MAX_RETRY_AFTER_MS = 10_000

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when the photo URL's host is not in the Google CDN allowlist. */
export class PhotoUrlNotAllowedError extends Error {
  constructor(host: string) {
    super(`Photo URL host not in allowlist: ${host}`)
    this.name = 'PhotoUrlNotAllowedError'
  }
}

/** Thrown when the photo exceeds the maximum allowed size. */
export class PhotoTooLargeError extends Error {
  constructor(bytes: number) {
    super(`Photo exceeds max size of ${PHOTO_MAX_BYTES} bytes (got ${bytes})`)
    this.name = 'PhotoTooLargeError'
  }
}

/** Thrown by attemptDownload when the server returns HTTP 429. */
export class RateLimitedError extends Error {
  readonly retryAfterMs: number | null
  constructor(retryAfterMs: number | null) {
    super('Photo fetch HTTP 429 (rate limited)')
    this.name = 'RateLimitedError'
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * Parse a Retry-After header value into milliseconds. Supports both
 * delta-seconds and HTTP-date forms (RFC 7231 §7.1.3). Caps the result at
 * MAX_RETRY_AFTER_MS so a misbehaving CDN cannot stall the sync for minutes.
 * Returns null when the header is missing or unparseable.
 */
function parseRetryAfter(headerValue: string | null): number | null {
  if (headerValue === null) return null
  const trimmed = headerValue.trim()
  if (trimmed === '') return null

  // Try delta-seconds (integer).
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10)
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  }

  // Try HTTP-date.
  const dateMs = Date.parse(trimmed)
  if (!isNaN(dateMs)) {
    const delta = dateMs - Date.now()
    return Math.min(Math.max(delta, 0), MAX_RETRY_AFTER_MS)
  }

  return null
}

/** Default sleep used between retries; injectable in tests. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DownloadPhotoResult {
  bytes: Uint8Array
  mime: string
  hash: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Hex-encode a SHA-256 digest of the provided bytes.
 * Uses crypto.subtle which is available in browsers and Node >=16.
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Cast through unknown to suppress TS strict-lib SharedArrayBuffer mismatch.
  // At runtime, Uint8Array is always a valid TypedArray for SubtleCrypto.digest.
  const buffer = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Single attempt to download a photo from the given URL.
 * Throws on network error, timeout, size-limit violation, or non-2xx response.
 */
async function attemptDownload(url: string, fetchImpl: typeof fetch): Promise<DownloadPhotoResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetchImpl(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
    // Best-effort drain so the connection can be reused for the retry.
    try {
      await response.body?.cancel()
    } catch {
      /* ignore */
    }
    throw new RateLimitedError(retryAfterMs)
  }

  if (!response.ok) {
    throw new Error(`Photo fetch HTTP ${response.status} for ${url}`)
  }

  // Check Content-Length before streaming — fast rejection for obviously large photos.
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const length = parseInt(contentLength, 10)
    if (!isNaN(length) && length > PHOTO_MAX_BYTES) {
      throw new PhotoTooLargeError(length)
    }
  }

  // Read the body, counting bytes and aborting if size limit is exceeded.
  const reader = response.body?.getReader()
  if (reader === undefined || reader === null) {
    throw new Error('Photo response has no readable body')
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let done = false
  while (!done) {
    const chunk = await reader.read()
    done = chunk.done
    if (chunk.value !== undefined) {
      totalBytes += chunk.value.byteLength
      if (totalBytes > PHOTO_MAX_BYTES) {
        await reader.cancel()
        throw new PhotoTooLargeError(totalBytes)
      }
      chunks.push(chunk.value)
    }
  }

  // Concatenate chunks into a single Uint8Array.
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  const mime = response.headers.get('content-type') ?? 'image/jpeg'
  const hash = await sha256Hex(bytes)
  return { bytes, mime, hash }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download a Google CDN photo, compute its SHA-256 hash, and return the result.
 *
 * Security: validates that the URL host is in GOOGLE_CDN_HOSTS before making
 * any HTTP request. Throws PhotoUrlNotAllowedError for any other host.
 *
 * Robustness: up to `maxRetries` retries on 429 / 5xx / network error with
 * exponential backoff [1s, 2s, 4s]. For 429, the Retry-After header
 * (delta-seconds or HTTP-date) is honored, capped at MAX_RETRY_AFTER_MS to
 * bound stalls. Pass `maxRetries=0` for fast-fail behavior (e.g. lazy
 * on-demand fetches where retrying would just spam a tarpitted CDN).
 * Timeout: 10 seconds per attempt.
 * Size limit: 5 MB; throws PhotoTooLargeError if exceeded.
 *
 * @param url        The Google CDN URL (must be lh3–lh6.googleusercontent.com).
 * @param fetchImpl  Optional fetch override for testing; defaults to globalThis.fetch.
 * @param sleepFn    Optional sleep override for testing; defaults to setTimeout.
 * @param maxRetries Maximum retry attempts (0..RETRY_BACKOFF_MS.length).
 *                   Default 3 (bulk sync). Use 0 for on-demand single attempts.
 */
export async function downloadPhoto(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  sleepFn: (ms: number) => Promise<void> = defaultSleep,
  maxRetries: number = RETRY_BACKOFF_MS.length,
): Promise<DownloadPhotoResult> {
  // Clamp to valid range; we never want negative retries or more than backoff entries.
  const effectiveMaxRetries = Math.min(Math.max(maxRetries, 0), RETRY_BACKOFF_MS.length)
  // Validate host before making any network request.
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new PhotoUrlNotAllowedError(url)
  }

  if (!GOOGLE_CDN_HOSTS.has(parsedUrl.hostname)) {
    throw new PhotoUrlNotAllowedError(parsedUrl.hostname)
  }

  let lastErr: unknown
  // Total attempts = 1 initial + effectiveMaxRetries retries.
  for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
    try {
      return await attemptDownload(url, fetchImpl)
    } catch (err) {
      lastErr = err

      // Never retry allowlist or size-limit violations — these are deterministic.
      if (err instanceof PhotoUrlNotAllowedError || err instanceof PhotoTooLargeError) {
        throw err
      }

      // Out of retries — bubble up the last error.
      if (attempt === effectiveMaxRetries) break

      // Choose wait before the next attempt based on error kind.
      // 4xx ≠ 429 → not retryable (auth, gone, etc.).
      let waitMs: number
      if (err instanceof RateLimitedError) {
        waitMs = err.retryAfterMs ?? RETRY_BACKOFF_MS[attempt]!
      } else if (err instanceof TypeError) {
        // Network error / aborted.
        waitMs = RETRY_BACKOFF_MS[attempt]!
      } else if (err instanceof Error && err.message.startsWith('Photo fetch HTTP 5')) {
        waitMs = RETRY_BACKOFF_MS[attempt]!
      } else {
        throw err
      }

      await sleepFn(waitMs)
    }
  }

  // Exhausted retries — rethrow the last observed error.
  if (lastErr instanceof Error) throw lastErr
  throw new Error(String(lastErr))
}
