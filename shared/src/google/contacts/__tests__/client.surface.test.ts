// client.surface.test.ts — surface guard for GoogleContactsClient (RO-INVARIANT L6.2).
// Ensures the class exposes no write methods and exactly four read methods.
//
// EDITING RULES:
// - Do NOT weaken FORBIDDEN_METHOD_PATTERN — it must cover all write verb prefixes.
// - Do NOT add write methods to the allowlist KNOWN_PRIVATE_HELPERS.
// - All comments must remain in English.

import { describe, it, expect } from 'vitest'
import { GoogleContactsClient } from '../read/client'

// Known private/internal helpers that are not part of the public API.
// TS access modifiers are erased at runtime, so these appear in getOwnPropertyNames.
const KNOWN_PRIVATE_HELPERS = new Set(['buildFetchOpts'])

describe('GoogleContactsClient surface (RO-INVARIANT L6.2)', () => {
  const FORBIDDEN_METHOD_PATTERN =
    /^(create|update|delete|patch|post|batch(Update|Delete)|put|remove|destroy|send|push|upload|insert)/i

  it('has no methods whose name implies write operations', () => {
    const proto = GoogleContactsClient.prototype as unknown as Record<string, unknown>
    const methodNames = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== 'constructor' && typeof proto[n] === 'function',
    )
    const offenders = methodNames.filter((n) => FORBIDDEN_METHOD_PATTERN.test(n))
    expect(offenders).toEqual([])
  })

  it('exposes exactly the four read methods (excluding known private helpers)', () => {
    const proto = GoogleContactsClient.prototype as unknown as Record<string, unknown>
    const expected = ['listConnections', 'getPerson', 'listContactGroups', 'getContactGroup']
    const actual = Object.getOwnPropertyNames(proto)
      .filter(
        (n) =>
          n !== 'constructor' && !KNOWN_PRIVATE_HELPERS.has(n) && typeof proto[n] === 'function',
      )
      .sort()
    expect(actual).toEqual(expected.sort())
  })
})
