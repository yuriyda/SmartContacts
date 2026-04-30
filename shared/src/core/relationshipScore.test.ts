/**
 * @file relationshipScore.test.ts
 * Tests for pure helpers: relationshipScore (0..100) and countFilledFields.
 * No DB, no React, no side effects.
 * Spec: docs/superpowers/specs/2026-04-29-contacts-app-design.md §15.4
 *
 * Rules:
 *  - All test fixtures must be built via makeContact() helper.
 *  - Tests assert relative monotonicity / boundary conditions, not exact tunable values.
 */

import { describe, test, expect } from 'vitest'
import type { Contact } from '../types'
import { relationshipScore, countFilledFields } from './relationshipScore'
import type { ScoreInput } from './relationshipScore'

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function makeContact(partial: Partial<Contact>): Contact {
  return {
    id: partial.id ?? 'id',
    createdAt: '',
    updatedAt: '',
    lamportTs: 1,
    deviceId: 'DEV',
    ...partial,
  }
}

// ---------------------------------------------------------------------------
// relationshipScore
// ---------------------------------------------------------------------------

describe('relationshipScore', () => {
  const NOW = new Date('2026-04-30T00:00:00.000Z').getTime()

  // 1. Empty contact: no priority, no lastContactedAt, no interactions, 0 completeness → score near 0
  test('empty input → score near 0', () => {
    const input: ScoreInput = {
      recentInteractionCount: 0,
      filledFieldCount: 0,
      now: NOW,
    }
    expect(relationshipScore(input)).toBe(0)
  })

  // 2. Fully-filled, freshly-contacted P1 with 10 interactions → score ≥ 80
  test('fully-filled fresh P1 with 10 interactions → score ≥ 80', () => {
    const freshAt = new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago
    const input: ScoreInput = {
      priority: 1,
      lastContactedAt: freshAt,
      recentInteractionCount: 10,
      filledFieldCount: 25,
      now: NOW,
    }
    expect(relationshipScore(input)).toBeGreaterThanOrEqual(80)
  })

  // 3. Stale P1 (lastContactedAt = 60 days ago, 0 interactions, mid completeness)
  test('stale P1 60 days ago → low score', () => {
    const staleAt = new Date(NOW - 60 * 24 * 60 * 60 * 1000).toISOString()
    const input: ScoreInput = {
      priority: 1,
      lastContactedAt: staleAt,
      recentInteractionCount: 0,
      filledFieldCount: 12,
      now: NOW,
    }
    // P1 decay is harsh; 60 days ago → recency very low
    expect(relationshipScore(input)).toBeLessThan(50)
  })

  // 4. Stale P5 (same 60 days, 0 interactions, same completeness) → higher than stale P1
  test('stale P5 60 days > stale P1 60 days (gentler decay)', () => {
    const staleAt = new Date(NOW - 60 * 24 * 60 * 60 * 1000).toISOString()
    const base: Omit<ScoreInput, 'priority'> = {
      lastContactedAt: staleAt,
      recentInteractionCount: 0,
      filledFieldCount: 12,
      now: NOW,
    }
    const scoreP1 = relationshipScore({ ...base, priority: 1 })
    const scoreP5 = relationshipScore({ ...base, priority: 5 })
    expect(scoreP5).toBeGreaterThan(scoreP1)
  })

  // 5. Decay monotonicity: same lastContactedAt + 0 interactions, P1→P5 → recency increases
  test('recency increases monotonically from P1 to P5', () => {
    const staleAt = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString()
    const scores: number[] = ([1, 2, 3, 4, 5] as const).map((p) =>
      relationshipScore({
        priority: p,
        lastContactedAt: staleAt,
        recentInteractionCount: 0,
        filledFieldCount: 0,
        now: NOW,
      }),
    )
    // Each step from P1 to P5 should be non-decreasing (gentler decay = higher score)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeGreaterThanOrEqual(scores[i - 1]!)
    }
  })

  // 6. Frequency cap: 100 interactions still clamp frequencyScore at 100
  test('100 recent interactions does not exceed max score', () => {
    const freshAt = new Date(NOW - 1 * 24 * 60 * 60 * 1000).toISOString()
    const input: ScoreInput = {
      priority: 1,
      lastContactedAt: freshAt,
      recentInteractionCount: 100,
      filledFieldCount: 25,
      now: NOW,
    }
    const score = relationshipScore(input)
    expect(score).toBeLessThanOrEqual(100)
    expect(score).toBeGreaterThanOrEqual(80)
  })

  // 7. Future lastContactedAt (now - lastContactedAt < 0) → recency clamped at 100, not error
  test('future lastContactedAt → recency clamped at 100 (no NaN/error)', () => {
    const futureAt = new Date(NOW + 10 * 24 * 60 * 60 * 1000).toISOString()
    const input: ScoreInput = {
      priority: 1,
      lastContactedAt: futureAt,
      recentInteractionCount: 0,
      filledFieldCount: 0,
      now: NOW,
    }
    const score = relationshipScore(input)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
    expect(Number.isNaN(score)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// countFilledFields
// ---------------------------------------------------------------------------

describe('countFilledFields', () => {
  // 1. Empty contact (only required sync fields): count === 0
  test('empty contact → count 0', () => {
    const c = makeContact({})
    expect(countFilledFields(c)).toBe(0)
  })

  // 2. givenName + familyName + 1 phone → count === 3
  test('givenName + familyName + 1 phone → count 3', () => {
    const c = makeContact({
      givenName: 'John',
      familyName: 'Doe',
      phones: [{ value: '+1234567890' }],
    })
    expect(countFilledFields(c)).toBe(3)
  })

  // 3. Empty array fields ([]) are NOT counted
  test('empty arrays are not counted', () => {
    const c = makeContact({
      phones: [],
      emails: [],
      addresses: [],
    })
    expect(countFilledFields(c)).toBe(0)
  })

  // 4. Empty/whitespace string fields are NOT counted
  test('empty or whitespace strings are not counted', () => {
    const c = makeContact({
      givenName: '',
      familyName: '   ',
      notesMd: '\t',
    })
    expect(countFilledFields(c)).toBe(0)
  })

  // 5. Empty object userDefined ({}) is NOT counted
  test('empty object userDefined is not counted', () => {
    const c = makeContact({ userDefined: {} })
    expect(countFilledFields(c)).toBe(0)
  })

  // 6. All 25 COUNTED_KEYS filled → count === 25
  test('all 25 filled keys → count 25', () => {
    const c = makeContact({
      givenName: 'First',
      familyName: 'Last',
      middleName: 'Mid',
      nickname: 'Nick',
      phones: [{ value: '+1' }],
      emails: [{ value: 'a@b.com' }],
      addresses: [{ city: 'NY' }],
      events: [{ date: '2000-01-01', type: 'birthday' }],
      organizations: [{ name: 'Acme' }],
      urls: [{ value: 'https://example.com' }],
      imClients: [{ protocol: 'telegram', handle: '@foo' }],
      relationsExternal: [{ person: 'Bob' }],
      groups: [{ id: 'g1' }],
      notesMd: 'Some notes',
      userDefined: { key: 'val' },
      locale: 'en-US',
      gender: 'male',
      occupation: 'Engineer',
      tags: ['vip'],
      relationsInternal: [{ contactId: 'other-id' }],
      customFields: { field1: 'value1' },
      lastContactedAt: '2026-01-01T00:00:00.000Z',
      preferredChannel: 'email',
      priority: 1,
      reminders: [{ id: 'r1', date: '2026-05-01', text: 'Call' }],
    })
    expect(countFilledFields(c)).toBe(25)
  })
})
