// Tests for the Tauri loopback OAuth PKCE flow and token refresh.
// All Tauri deps (invoke, openUrl) and fetch are injected mocks — no real network calls.

import { describe, it, expect, vi } from 'vitest'
import { runTauriLoopbackOauthFlow, refreshAccessToken, InvalidGrantError } from './tauri-loopback'
import { ScopeViolationError } from '../shared/errors'
import { OAUTH_SCOPE } from './config'

// ---------------------------------------------------------------------------
// Helpers

function makeTokenResponse(overrides?: {
  access_token?: string
  refresh_token?: string | null
  expires_in?: number
  scope?: string
}) {
  const base: {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
    token_type: string
  } = {
    access_token: 'access-token-abc',
    refresh_token: 'refresh-token-xyz',
    expires_in: 3600,
    scope: OAUTH_SCOPE,
    token_type: 'Bearer',
  }
  if (overrides) {
    if (overrides.access_token !== undefined) base.access_token = overrides.access_token
    if (overrides.refresh_token !== undefined) {
      if (overrides.refresh_token === null) delete base.refresh_token
      else base.refresh_token = overrides.refresh_token
    }
    if (overrides.expires_in !== undefined) base.expires_in = overrides.expires_in
    if (overrides.scope !== undefined) base.scope = overrides.scope
  }
  return base
}

function makeFetchMock(responseBody: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  }) as unknown as typeof fetch
}

function makeInvokeMock(port = 8888, code = 'auth-code-123') {
  return vi.fn().mockImplementation(async (cmd: string, _args: Record<string, unknown>) => {
    if (cmd === 'oauth_start') return port
    if (cmd === 'oauth_await_code') return code
    throw new Error(`Unexpected command: ${cmd}`)
  })
}

// ---------------------------------------------------------------------------
// runTauriLoopbackOauthFlow

const TEST_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'

describe('runTauriLoopbackOauthFlow', () => {
  it('happy path: returns accessToken, refreshToken, expiresIn, grantedAt', async () => {
    const invoke = makeInvokeMock()
    const openUrl = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = makeFetchMock(makeTokenResponse())

    const result = await runTauriLoopbackOauthFlow({
      invoke,
      openUrl,
      fetchImpl,
      clientId: TEST_CLIENT_ID,
    })

    expect(result.accessToken).toBe('access-token-abc')
    expect(result.refreshToken).toBe('refresh-token-xyz')
    expect(result.expiresIn).toBe(3600)
    expect(typeof result.grantedAt).toBe('string')
    // grantedAt should be a valid ISO date
    expect(() => new Date(result.grantedAt)).not.toThrow()
  })

  it('calls oauth_start and oauth_await_code on invoke', async () => {
    const invoke = makeInvokeMock()
    const openUrl = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = makeFetchMock(makeTokenResponse())

    await runTauriLoopbackOauthFlow({ invoke, openUrl, fetchImpl, clientId: TEST_CLIENT_ID })

    expect(invoke).toHaveBeenCalledWith('oauth_start', expect.any(Object))
    expect(invoke).toHaveBeenCalledWith('oauth_await_code', expect.any(Object))
  })

  it('opens the browser with the authorization URL', async () => {
    const invoke = makeInvokeMock()
    const openUrl = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = makeFetchMock(makeTokenResponse())

    await runTauriLoopbackOauthFlow({ invoke, openUrl, fetchImpl, clientId: TEST_CLIENT_ID })

    expect(openUrl).toHaveBeenCalledTimes(1)
    const url: string = openUrl.mock.calls[0][0] as string
    expect(url).toContain('accounts.google.com')
    expect(url).toContain('code_challenge_method=S256')
    // redirect_uri is URL-encoded in the query string
    expect(url).toContain('127.0.0.1%3A8888')
  })

  it('throws ScopeViolationError and does NOT return tokens when scope is broader than allowed', async () => {
    const invoke = makeInvokeMock()
    const openUrl = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = makeFetchMock(
      makeTokenResponse({
        scope: `${OAUTH_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
      }),
    )

    await expect(
      runTauriLoopbackOauthFlow({ invoke, openUrl, fetchImpl, clientId: TEST_CLIENT_ID }),
    ).rejects.toThrow(ScopeViolationError)
  })

  it('throws ScopeViolationError when scope is completely different', async () => {
    const invoke = makeInvokeMock()
    const openUrl = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = makeFetchMock(
      makeTokenResponse({ scope: 'https://www.googleapis.com/auth/userinfo.email' }),
    )

    await expect(
      runTauriLoopbackOauthFlow({ invoke, openUrl, fetchImpl, clientId: TEST_CLIENT_ID }),
    ).rejects.toThrow(ScopeViolationError)
  })

  it('throws OAUTH_NO_REFRESH_TOKEN when token response has empty-string refresh_token', async () => {
    const invoke = makeInvokeMock()
    const openUrl = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = makeFetchMock(makeTokenResponse({ refresh_token: '' }))

    await expect(
      runTauriLoopbackOauthFlow({ invoke, openUrl, fetchImpl, clientId: TEST_CLIENT_ID }),
    ).rejects.toThrow('OAUTH_NO_REFRESH_TOKEN')
  })

  it('throws OAUTH_NO_REFRESH_TOKEN when token response has no refresh_token field', async () => {
    const invoke = makeInvokeMock()
    const openUrl = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = makeFetchMock(makeTokenResponse({ refresh_token: null }))

    await expect(
      runTauriLoopbackOauthFlow({ invoke, openUrl, fetchImpl, clientId: TEST_CLIENT_ID }),
    ).rejects.toThrow('OAUTH_NO_REFRESH_TOKEN')
  })

  it('propagates invoke rejection (simulates Rust state-mismatch error)', async () => {
    const invoke = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === 'oauth_start') return 8888
      if (cmd === 'oauth_await_code') throw new Error('state_mismatch')
      throw new Error(`Unexpected: ${cmd}`)
    })
    const openUrl = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = makeFetchMock(makeTokenResponse())

    await expect(
      runTauriLoopbackOauthFlow({ invoke, openUrl, fetchImpl, clientId: TEST_CLIENT_ID }),
    ).rejects.toThrow('state_mismatch')
  })
})

// ---------------------------------------------------------------------------
// refreshAccessToken

describe('refreshAccessToken', () => {
  it('happy path: returns new accessToken and expiresIn', async () => {
    const fetchImpl = makeFetchMock(makeTokenResponse({ refresh_token: null }))

    const result = await refreshAccessToken({
      refreshToken: 'old-refresh-token',
      clientId: TEST_CLIENT_ID,
      fetchImpl,
    })

    expect(result.accessToken).toBe('access-token-abc')
    expect(result.expiresIn).toBe(3600)
    expect(result.refreshToken).toBeNull()
  })

  it('returns new refreshToken when Google rotates it', async () => {
    const fetchImpl = makeFetchMock(makeTokenResponse({ refresh_token: 'new-refresh-token' }))

    const result = await refreshAccessToken({
      refreshToken: 'old-refresh-token',
      clientId: TEST_CLIENT_ID,
      fetchImpl,
    })

    expect(result.refreshToken).toBe('new-refresh-token')
  })

  it('throws ScopeViolationError when refresh response has unexpected scope', async () => {
    const fetchImpl = makeFetchMock(
      makeTokenResponse({ scope: 'https://www.googleapis.com/auth/contacts' }),
    )

    await expect(
      refreshAccessToken({ refreshToken: 'rt', clientId: TEST_CLIENT_ID, fetchImpl }),
    ).rejects.toThrow(ScopeViolationError)
  })

  it('throws when token endpoint returns non-ok status', async () => {
    const fetchImpl = makeFetchMock({ error: 'server_error' }, 500)

    await expect(
      refreshAccessToken({ refreshToken: 'expired-rt', clientId: TEST_CLIENT_ID, fetchImpl }),
    ).rejects.toThrow('Token refresh failed (500)')
  })

  it('throws InvalidGrantError when Google returns invalid_grant (HTTP 400)', async () => {
    const fetchImpl = makeFetchMock(
      { error: 'invalid_grant', error_description: 'Token has been revoked' },
      400,
    )

    await expect(
      refreshAccessToken({ refreshToken: 'revoked-rt', clientId: TEST_CLIENT_ID, fetchImpl }),
    ).rejects.toBeInstanceOf(InvalidGrantError)
  })

  it('InvalidGrantError message contains INVALID_GRANT', async () => {
    const fetchImpl = makeFetchMock({ error: 'invalid_grant' }, 400)

    const err = await refreshAccessToken({
      refreshToken: 'expired-rt',
      clientId: TEST_CLIENT_ID,
      fetchImpl,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(InvalidGrantError)
    expect((err as Error).message).toContain('INVALID_GRANT')
  })
})
