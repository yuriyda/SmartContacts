// HTTP fetch wrapper for Google People API with defense layers.
// Enforces: method whitelist (L2.1), URL allowlist (L2.2), audit callback (L2.3).
//
// EDITING RULES:
// - Do NOT weaken or bypass the method check or URL allowlist — both are hard invariants (INV-7).
// - Do NOT add non-GET methods to ALLOWED_METHODS or broaden ALLOWED_URL_PATTERNS.
// - All guard checks must remain as the FIRST operations in googleApiFetch.
// - All comments must remain in English.

// RO-INVARIANT: L2.1, L2.2, L2.3

import { ReadOnlyViolationError, UrlAllowlistViolationError } from './errors'

/**
 * Patterns that exactly describe every read endpoint used by Phase 1.
 * Each pattern matches the base path with optional query string (? or end-of-string).
 * Write-only endpoints (e.g. people:batchUpdate) intentionally do NOT match any pattern.
 */
export const ALLOWED_URL_PATTERNS: RegExp[] = [
  /^https:\/\/people\.googleapis\.com\/v1\/people\/me\/connections(\?|$)/,
  /^https:\/\/people\.googleapis\.com\/v1\/people\/[^/]+(\?|$)/,
  /^https:\/\/people\.googleapis\.com\/v1\/contactGroups(\?|$)/,
  /^https:\/\/people\.googleapis\.com\/v1\/contactGroups\/[^/]+(\?|$)/,
]

/** Callback type for HTTP audit logging (L2.3). */
export type HttpAuditFn = (entry: {
  method: string
  url: string
  status: number
  durationMs: number
}) => Promise<void> | void

/** Options for googleApiFetch. */
export interface GoogleApiFetchOptions {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  audit?: HttpAuditFn
  /** Injectable fetch implementation for testing. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch
}

/**
 * Fetch wrapper for Google People API with enforced read-only defense layers.
 *
 * Guard order (must not be reordered):
 *  1. Method whitelist (L2.1): only GET allowed.
 *  2. URL allowlist (L2.2): only pre-approved People API endpoints.
 *  3. Execute fetch.
 *  4. Audit callback (L2.3): called in finally, always fires.
 *
 * Returns the raw Response. Callers are responsible for checking response.ok
 * and handling 4xx/5xx per §9.1.
 */
export async function googleApiFetch(opts: GoogleApiFetchOptions): Promise<Response> {
  // L2.1: method whitelist — only GET permitted
  if (opts.method !== 'GET') {
    throw new ReadOnlyViolationError(opts.method)
  }

  // L2.2: URL allowlist — must match one of the approved patterns
  const urlAllowed = ALLOWED_URL_PATTERNS.some((pattern) => pattern.test(opts.url))
  if (!urlAllowed) {
    throw new UrlAllowlistViolationError(opts.url)
  }

  const fetchFn = opts.fetchImpl ?? fetch
  const start = performance.now()
  let response: Response | undefined

  try {
    const init: RequestInit = { method: 'GET' }
    if (opts.headers !== undefined) init.headers = opts.headers
    if (opts.body !== undefined) init.body = opts.body
    response = await fetchFn(opts.url, init)
    return response
  } finally {
    // L2.3: audit callback fires regardless of success or error
    if (opts.audit !== undefined) {
      await opts.audit({
        method: opts.method,
        url: opts.url,
        status: response?.status ?? 0,
        durationMs: performance.now() - start,
      })
    }
  }
}
