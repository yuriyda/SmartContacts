// Verifies that the OAuth scope granted by Google exactly matches the required read-only scope.
// This is defense layer L1.2: granted scope must equal the requested scope — nothing more, nothing less.
//
// EDITING RULES:
// - Do NOT weaken the exact-match assertion — broader scopes are still rejected (INV-7, L1.2).
// - Do NOT accept multiple scopes even if our scope is among them.
// - All comments must remain in English.

// RO-INVARIANT: L1.2

import { OAUTH_SCOPE } from './config'
import { ScopeViolationError } from '../shared/errors'

/**
 * Asserts that scopeFromResponse exactly equals OAUTH_SCOPE (after trimming whitespace).
 * Throws ScopeViolationError if the scope is missing, differs, or contains additional scopes.
 */
export function verifyGrantedScope(scopeFromResponse: string): void {
  const parts = scopeFromResponse.trim().split(/\s+/).filter(Boolean)

  if (parts.length !== 1 || parts[0] !== OAUTH_SCOPE) {
    throw new ScopeViolationError(
      `Scope violation: expected exactly "${OAUTH_SCOPE}" but received "${scopeFromResponse.trim()}". ` +
        `Parsed parts: [${parts.map((p) => `"${p}"`).join(', ')}].`,
    )
  }
}
