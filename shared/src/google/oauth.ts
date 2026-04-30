// OAuth stub and interfaces for Smart Contacts Google integration.
// This module provides the token-source abstraction used by driveAppdata.ts.
// P5 will replace makeStubAccessTokenSource with a real GIS-based implementation.
//
// Editing rules:
// - Keep this module focused on token plumbing only — no Drive HTTP logic here.
// - makeStubAccessTokenSource must always throw OAuthNotConfiguredError until P5 wires GIS.
// - OAuthConfig and AccessTokenSource interfaces are the stable public contract;
//   do not change them without updating all consumers.

// ---------------------------------------------------------------------------
// Errors

/** Thrown when an OAuth token is requested but OAuth has not been configured. */
export class OAuthNotConfiguredError extends Error {
  constructor() {
    super('OAUTH_NOT_CONFIGURED')
    this.name = 'OAuthNotConfiguredError'
  }
}

// ---------------------------------------------------------------------------
// Interfaces

/** Configuration required to initialise an OAuth client. */
export interface OAuthConfig {
  clientId: string
  scopes: string[]
}

/** Abstraction over any access-token provider. */
export interface AccessTokenSource {
  getAccessToken(): Promise<string>
}

// ---------------------------------------------------------------------------
// Factory

/**
 * Returns a stub token source that always rejects with OAuthNotConfiguredError.
 * Replace this with a real GIS-based implementation in P5.
 */
export function makeStubAccessTokenSource(): AccessTokenSource {
  return {
    async getAccessToken(): Promise<string> {
      throw new OAuthNotConfiguredError()
    },
  }
}
