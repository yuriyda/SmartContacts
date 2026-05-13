// photo-fetch.ts — Downloads a Google CDN avatar photo and returns its bytes, MIME type, and SHA-256 hash.
//
// EDITING RULES:
//  - Do NOT use googleApiFetch here; that helper is for People API calls only.
//  - Only hosts in GOOGLE_CDN_HOSTS are allowed — throws PhotoUrlNotAllowedError for others.
//  - Enforce 10s timeout and 5MB max size.
//  - One retry on 5xx or network error (no backoff — photos are non-critical).
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
 * Robustness: one retry on 5xx or network error (non-critical data path).
 * Timeout: 10 seconds per attempt.
 * Size limit: 5 MB; throws PhotoTooLargeError if exceeded.
 *
 * @param url        The Google CDN URL (must be lh3–lh6.googleusercontent.com).
 * @param fetchImpl  Optional fetch override for testing; defaults to globalThis.fetch.
 */
export async function downloadPhoto(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<DownloadPhotoResult> {
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

  // First attempt.
  try {
    return await attemptDownload(url, fetchImpl)
  } catch (firstErr) {
    // Retry once on 5xx or network error. Do not retry on allowlist/size violations.
    if (firstErr instanceof PhotoUrlNotAllowedError || firstErr instanceof PhotoTooLargeError) {
      throw firstErr
    }
    // Check if it's a 5xx error (message starts with "Photo fetch HTTP 5").
    const is5xx = firstErr instanceof Error && firstErr.message.startsWith('Photo fetch HTTP 5')
    const isNetworkError = firstErr instanceof TypeError
    if (is5xx || isNetworkError) {
      return await attemptDownload(url, fetchImpl)
    }
    throw firstErr
  }
}
