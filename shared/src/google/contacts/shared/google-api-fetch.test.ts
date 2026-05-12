// Tests for google-api-fetch.ts — verifies all defense layers (L2.1, L2.2, L2.3).
// Uses injectable fetchImpl to avoid real network calls.
//
// EDITING RULES:
// - Do NOT remove or weaken any test in this file — each guards a hard invariant.
// - Add new test cases when ALLOWED_URL_PATTERNS is extended (requires spec amendment).
// - All comments must remain in English.

import { describe, expect, test, vi } from 'vitest'
import { googleApiFetch } from './google-api-fetch'
import { ReadOnlyViolationError, UrlAllowlistViolationError } from './errors'

// ---------------------------------------------------------------------------
// Helpers

function okFetch(status = 200): typeof fetch {
  return vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch
}

// ---------------------------------------------------------------------------
// L2.1: HTTP method whitelist

describe('L2.1 — method whitelist', () => {
  test('POST throws ReadOnlyViolationError', async () => {
    await expect(
      googleApiFetch({
        method: 'POST',
        url: 'https://people.googleapis.com/v1/people/me/connections',
        fetchImpl: okFetch(),
      }),
    ).rejects.toThrow(ReadOnlyViolationError)
  })

  test('PATCH throws ReadOnlyViolationError', async () => {
    await expect(
      googleApiFetch({
        method: 'PATCH',
        url: 'https://people.googleapis.com/v1/people/me/connections',
        fetchImpl: okFetch(),
      }),
    ).rejects.toThrow(ReadOnlyViolationError)
  })

  test('DELETE throws ReadOnlyViolationError', async () => {
    await expect(
      googleApiFetch({
        method: 'DELETE',
        url: 'https://people.googleapis.com/v1/people/me/connections',
        fetchImpl: okFetch(),
      }),
    ).rejects.toThrow(ReadOnlyViolationError)
  })
})

// ---------------------------------------------------------------------------
// L2.2: URL allowlist

describe('L2.2 — URL allowlist', () => {
  test('GET to unknown domain throws UrlAllowlistViolationError', async () => {
    await expect(
      googleApiFetch({
        method: 'GET',
        url: 'https://example.com/foo',
        fetchImpl: okFetch(),
      }),
    ).rejects.toThrow(UrlAllowlistViolationError)
  })

  test('GET to people:batchUpdate (write endpoint) throws UrlAllowlistViolationError', async () => {
    await expect(
      googleApiFetch({
        method: 'GET',
        url: 'https://people.googleapis.com/v1/people:batchUpdate',
        fetchImpl: okFetch(),
      }),
    ).rejects.toThrow(UrlAllowlistViolationError)
  })

  test('GET to connections list with query string passes through to fetchImpl', async () => {
    const fetchImpl = okFetch()
    const response = await googleApiFetch({
      method: 'GET',
      url: 'https://people.googleapis.com/v1/people/me/connections?pageSize=100',
      fetchImpl,
    })
    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  test('GET to specific person resource passes through to fetchImpl', async () => {
    // People API resource names use a flat single-segment ID after /people/
    // e.g. people.get uses URL: /v1/people/c1234567890
    const fetchImpl = okFetch()
    const response = await googleApiFetch({
      method: 'GET',
      url: 'https://people.googleapis.com/v1/people/c1234567890?personFields=names',
      fetchImpl,
    })
    expect(response.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// L2.3: Audit callback

describe('L2.3 — audit callback', () => {
  test('audit is called with correct fields on successful GET', async () => {
    const url = 'https://people.googleapis.com/v1/people/me/connections?pageSize=10'
    const audit = vi.fn()
    await googleApiFetch({
      method: 'GET',
      url,
      fetchImpl: okFetch(200),
      audit,
    })

    expect(audit).toHaveBeenCalledOnce()
    const entry = audit.mock.calls[0]![0] as {
      method: string
      url: string
      status: number
      durationMs: number
    }
    expect(entry.method).toBe('GET')
    expect(entry.url).toBe(url)
    expect(entry.status).toBe(200)
    expect(typeof entry.durationMs).toBe('number')
    expect(entry.durationMs).toBeGreaterThanOrEqual(0)
  })
})
