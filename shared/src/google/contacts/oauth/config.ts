// OAuth configuration constants for Google Contacts sync.
// This module is the single source of truth for OAuth endpoints and scope.
//
// client_id is intentionally NOT here — it is stored at runtime in the meta table
// via makeClientIdStore() and read by factory.ts at OAuth-time (no build-time injection).
//
// EDITING RULES:
// - OAUTH_SCOPE must remain contacts.readonly only — do NOT add broader scopes (INV-7, L1.1).
// - Do NOT add client_secret here or anywhere in shared/ — PKCE flow only, no secret.
// - Do NOT re-add GOOGLE_OAUTH_CLIENT_ID or any env-var reading — use client-id-store.ts.
// - All comments must remain in English.

/** The only OAuth scope requested and accepted by Phase 1. */
export const OAUTH_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly' as const

/** Google OAuth 2.0 authorization endpoint. */
export const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth' as const

/** Google OAuth 2.0 token endpoint. */
export const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token' as const
