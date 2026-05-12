// OAuth configuration constants and environment bindings for Google Contacts sync.
// This module is the single source of truth for OAuth endpoints, scopes, and client ID resolution.
//
// EDITING RULES:
// - OAUTH_SCOPE must remain contacts.readonly only — do NOT add broader scopes (INV-7, L1.1).
// - Do NOT add client_secret here or anywhere in shared/ — PKCE flow only, no secret.
// - All comments must remain in English.

/** The only OAuth scope requested and accepted by Phase 1. */
export const OAUTH_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly' as const

/** Google OAuth 2.0 authorization endpoint. */
export const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth' as const

/** Google OAuth 2.0 token endpoint. */
export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token' as const

/**
 * Resolves the Google OAuth client ID from environment variables.
 * In Vite/Tauri context: reads VITE_SMART_CONTACTS_GOOGLE_CLIENT_ID.
 * In Node/test context: reads SMART_CONTACTS_GOOGLE_CLIENT_ID from process.env.
 * Falls back to empty string if neither is available.
 */
export const GOOGLE_OAUTH_CLIENT_ID: string = (() => {
  // Check for Vite/browser runtime
  if (
    typeof import.meta !== 'undefined' &&
    typeof (import.meta as unknown as { env?: unknown }).env === 'object'
  ) {
    const viteEnv = (import.meta as unknown as { env: Record<string, string | undefined> }).env
    const viteId = viteEnv['VITE_SMART_CONTACTS_GOOGLE_CLIENT_ID']
    if (viteId) return viteId
  }
  // Fall back to Node process.env (test / server environment)
  if (typeof process !== 'undefined' && process.env) {
    const nodeId = process.env['SMART_CONTACTS_GOOGLE_CLIENT_ID']
    if (nodeId) return nodeId
  }
  return ''
})()

/** Returns true if a client ID has been configured. */
export function isOauthConfigured(): boolean {
  return GOOGLE_OAUTH_CLIENT_ID.length > 0
}
