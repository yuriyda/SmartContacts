// Tests for isConsentFresh (L7.2).
// Covers null, just-now, boundary days, and custom maxAgeDays.

import { describe, it, expect } from 'vitest'
import { isConsentFresh } from './consent-policy'

const now = new Date('2026-05-10T12:00:00.000Z')

function daysAgo(days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('isConsentFresh', () => {
  it('returns false when latestConsentTs is null', () => {
    expect(isConsentFresh(null, now)).toBe(false)
  })

  it('returns true for a just-now consent (0 days ago)', () => {
    expect(isConsentFresh(now.toISOString(), now)).toBe(true)
  })

  it('returns true when consent is 89 days old (within 90-day window)', () => {
    expect(isConsentFresh(daysAgo(89), now)).toBe(true)
  })

  it('returns false when consent is 91 days old (outside 90-day window)', () => {
    expect(isConsentFresh(daysAgo(91), now)).toBe(false)
  })

  it('returns false when consent is 31 days old with custom maxAgeDays=30', () => {
    expect(isConsentFresh(daysAgo(31), now, 30)).toBe(false)
  })
})
