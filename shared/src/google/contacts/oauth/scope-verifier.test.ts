// Tests for the OAuth scope verifier (L1.2).
// Confirms that exact scope match passes and any deviation (missing, broader, empty) throws.

import { describe, it, expect } from 'vitest'
import { verifyGrantedScope } from './scope-verifier'
import { ScopeViolationError } from '../shared/errors'
import { OAUTH_SCOPE } from './config'

describe('verifyGrantedScope', () => {
  it('passes when scope exactly matches OAUTH_SCOPE', () => {
    expect(() => verifyGrantedScope(OAUTH_SCOPE)).not.toThrow()
  })

  it('throws ScopeViolationError when scope is empty string', () => {
    expect(() => verifyGrantedScope('')).toThrow(ScopeViolationError)
  })

  it('throws ScopeViolationError when required scope is missing entirely', () => {
    expect(() => verifyGrantedScope('https://www.googleapis.com/auth/userinfo.email')).toThrow(
      ScopeViolationError,
    )
  })

  it('throws ScopeViolationError when response contains broader scope (our scope + extra)', () => {
    expect(() =>
      verifyGrantedScope(`${OAUTH_SCOPE} https://www.googleapis.com/auth/userinfo.email`),
    ).toThrow(ScopeViolationError)
  })

  it('passes when scope has leading/trailing whitespace but is otherwise exact', () => {
    expect(() => verifyGrantedScope(`  ${OAUTH_SCOPE}  `)).not.toThrow()
  })
})
