// Tauri loopback OAuth 2.0 PKCE flow for Google Contacts read-only access.
// Orchestrates: PKCE code generation → Tauri TCP loopback listener → browser consent →
// authorization code exchange → scope verification → token return.
//
// client_id is injected via deps.clientId (read from meta table by factory.ts at call-time).
// This avoids binding client_id at construction time so UI changes take effect immediately.
//
// EDITING RULES:
// - Do NOT import @tauri-apps/* directly — invoke and openUrl are injected deps (platform-agnostic).
// - Do NOT add client_secret to token exchange — PKCE only (no secret flow).
// - verifyGrantedScope must be called on EVERY token response before tokens are returned (L1.2).
// - refreshAccessToken must also verify scope on every refresh response.
// - All comments must remain in English.

// RO-INVARIANT: L1.1, L1.2

import { OAUTH_SCOPE, OAUTH_AUTH_URL, OAUTH_TOKEN_URL } from './config'
import { verifyGrantedScope } from './scope-verifier'

// ---------------------------------------------------------------------------
// Return types

/** Result of a successful initial OAuth authorization. */
export interface OAuthTokenResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  grantedAt: string
}

/** Result of a successful token refresh. */
export interface RefreshTokenResult {
  accessToken: string
  /** New refresh token if Google rotated it; otherwise the same token as before. */
  refreshToken: string | null
  expiresIn: number
}

// ---------------------------------------------------------------------------
// Internal type for token endpoint responses

interface TokenEndpointResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  token_type?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Error type for revoked / expired refresh tokens

/**
 * Thrown by refreshAccessToken when Google returns invalid_grant (HTTP 400).
 * Indicates the refresh token is no longer valid — user revoked access or
 * the token expired. Callers should clear stored tokens and prompt re-auth.
 */
export class InvalidGrantError extends Error {
  constructor() {
    super('INVALID_GRANT: Refresh token is no longer valid (user revoked access or token expired).')
    this.name = 'InvalidGrantError'
  }
}

// ---------------------------------------------------------------------------
// Shared token response parser

/**
 * Parses a successful token endpoint JSON response into a typed structure.
 * refreshToken is null when Google did not include it (acceptable on refresh;
 * the initial-auth caller must reject null before this function is reached).
 */
function parseTokenResponse(json: TokenEndpointResponse): {
  accessToken: string
  refreshToken: string | null
  expiresIn: number
} {
  return {
    accessToken: json.access_token,
    refreshToken:
      json.refresh_token != null && json.refresh_token !== '' ? json.refresh_token : null,
    expiresIn: json.expires_in,
  }
}

// ---------------------------------------------------------------------------
// Dependency injection interface

/** Injected platform dependencies — keeps shared/ free of @tauri-apps/* imports. */
export interface TauriLoopbackDeps {
  /** Calls a Tauri command by name with the given arguments. */
  invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>
  /** Opens a URL in the system browser. */
  openUrl: (url: string) => Promise<void>
  /** Google OAuth client_id — read from meta table at call-time, injected here. */
  clientId: string
  /** Optional custom fetch implementation (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch
}

// ---------------------------------------------------------------------------
// PKCE helpers

/** Converts a Uint8Array to a base64url-encoded string (no padding). */
function toBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Generates a PKCE code_verifier: 64 URL-safe random characters. */
function generateCodeVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const bytes = new Uint8Array(64)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

/** Computes the PKCE code_challenge: base64url(SHA-256(verifier)). */
async function computeCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toBase64Url(new Uint8Array(digest))
}

/** Generates a random state parameter: 16 bytes → base64url. */
function generateState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

// ---------------------------------------------------------------------------
// Main flow

/**
 * Runs the full Tauri loopback OAuth 2.0 PKCE authorization code flow.
 * Steps: PKCE setup → Tauri TCP listener → browser → code exchange → scope verify → return tokens.
 */
export async function runTauriLoopbackOauthFlow(
  deps: TauriLoopbackDeps,
): Promise<OAuthTokenResult> {
  const fetchFn = deps.fetchImpl ?? globalThis.fetch

  // Step a: Generate PKCE code verifier
  const codeVerifier = generateCodeVerifier()

  // Step b: Compute code challenge
  const codeChallenge = await computeCodeChallenge(codeVerifier)

  // Step c: Generate state
  const state = generateState()

  // Step d: Start Tauri TCP loopback listener; returns the ephemeral port
  const port = (await deps.invoke('oauth_start', { state })) as number

  // Step e: Build authorization URL
  const redirectUri = `http://127.0.0.1:${port}`
  const authParams = new URLSearchParams({
    client_id: deps.clientId,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  })
  const authUrl = `${OAUTH_AUTH_URL}?${authParams.toString()}`

  // Step f: Open browser for user consent
  await deps.openUrl(authUrl)

  // Step g: Wait for Tauri to capture the authorization code from the loopback redirect
  const code = (await deps.invoke('oauth_await_code', { state })) as string

  // Step h: Exchange authorization code for tokens (NO client_secret — PKCE only)
  const tokenBody = new URLSearchParams({
    code,
    client_id: deps.clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  })

  const tokenResponse = await fetchFn(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  })

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text()
    throw new Error(`Token exchange failed (${tokenResponse.status}): ${errText}`)
  }

  const tokenData = (await tokenResponse.json()) as TokenEndpointResponse

  // Step i: Verify granted scope — throws ScopeViolationError if scope differs
  verifyGrantedScope(tokenData.scope ?? '')

  // Step j: Parse and validate tokens
  const parsed = parseTokenResponse(tokenData)

  // Google MUST return a refresh_token on the initial authorization code exchange.
  // It is omitted only when the user previously granted offline access and
  // prompt=consent was not used — but we always request prompt=consent above, so
  // receiving no refresh_token here is an unexpected / misconfigured state.
  if (parsed.refreshToken === null) {
    throw new Error(
      'OAUTH_NO_REFRESH_TOKEN: Google did not return a refresh_token. ' +
        'Make sure you requested access_type=offline and prompt=consent, and that the user ' +
        'has not previously granted offline access to this client (in which case Google omits ' +
        'refresh_token unless prompt=consent forces re-issuance).',
    )
  }

  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresIn: parsed.expiresIn,
    grantedAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Token refresh

/** Dependencies for refreshAccessToken. */
export interface RefreshDeps {
  refreshToken: string
  /** Google OAuth client_id — read from meta table at call-time, injected here. */
  clientId: string
  fetchImpl?: typeof fetch
}

/**
 * Exchanges a refresh token for a new access token.
 * Also verifies the granted scope on the refresh response.
 * Returns a new refresh token if Google rotated it.
 */
export async function refreshAccessToken(deps: RefreshDeps): Promise<RefreshTokenResult> {
  const fetchFn = deps.fetchImpl ?? globalThis.fetch

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: deps.refreshToken,
    client_id: deps.clientId,
  })

  const response = await fetchFn(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    // Detect Google's invalid_grant error (revoked token / expired grant).
    // Parse as JSON first; fall back to text for non-JSON error bodies.
    let errorCode: string | undefined
    let errText: string
    try {
      const errBody = (await response.json()) as TokenEndpointResponse
      errorCode = errBody.error
      errText = JSON.stringify(errBody)
    } catch {
      errText = await response.text()
    }

    if (errorCode === 'invalid_grant') {
      throw new InvalidGrantError()
    }

    throw new Error(`Token refresh failed (${response.status}): ${errText}`)
  }

  const data = (await response.json()) as TokenEndpointResponse

  // Always verify scope on refresh responses too
  verifyGrantedScope(data.scope ?? '')

  const parsed = parseTokenResponse(data)

  return {
    accessToken: parsed.accessToken,
    // null when Google did not rotate the refresh token (expected on most refreshes)
    refreshToken: parsed.refreshToken,
    expiresIn: parsed.expiresIn,
  }
}
