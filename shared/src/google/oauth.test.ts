// Tests for the OAuth stub module.
// Verifies that the stub token source always rejects with OAuthNotConfiguredError.
import { describe, expect, test } from 'vitest'
import { makeStubAccessTokenSource, OAuthNotConfiguredError } from './oauth'

describe('makeStubAccessTokenSource', () => {
  test('getAccessToken rejects with OAuthNotConfiguredError', async () => {
    const source = makeStubAccessTokenSource()
    await expect(source.getAccessToken()).rejects.toBeInstanceOf(OAuthNotConfiguredError)
  })

  test('getAccessToken rejects with message OAUTH_NOT_CONFIGURED', async () => {
    const source = makeStubAccessTokenSource()
    await expect(source.getAccessToken()).rejects.toThrow('OAUTH_NOT_CONFIGURED')
  })

  test('OAuthNotConfiguredError has name OAuthNotConfiguredError', async () => {
    const source = makeStubAccessTokenSource()
    try {
      await source.getAccessToken()
    } catch (e) {
      expect((e as Error).name).toBe('OAuthNotConfiguredError')
    }
  })
})
