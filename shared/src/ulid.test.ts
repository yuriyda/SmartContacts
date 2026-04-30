// Tests for the ULID generator (Crockford-base32 timestamp + entropy).
// Verifies format, monotonicity within the same millisecond, and uniqueness.
import { describe, expect, test } from 'vitest'
import { ulid } from './ulid'

describe('ulid', () => {
  test('produces 26-char Crockford-base32 string', () => {
    const id = ulid()
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })
  test('produces monotonically non-decreasing values within the same ms', () => {
    const ids = Array.from({ length: 100 }, () => ulid())
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })
  test('produces unique values across 1000 calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => ulid()))
    expect(set.size).toBe(1000)
  })
  test('ULIDs generated across a ms boundary remain unique and ordered', async () => {
    const before = Array.from({ length: 50 }, () => ulid())
    await new Promise((r) => setTimeout(r, 2))
    const after = Array.from({ length: 50 }, () => ulid())
    const all = [...before, ...after]
    expect(new Set(all).size).toBe(100)
    expect(before[49]! < after[0]!).toBe(true)
  })
})
