/**
 * @file undoCapacity.test.ts
 * Unit tests for the pushWithCapacity helper used by the undo store.
 * Rules: no React, no DOM.
 */

import { describe, test, expect } from 'vitest'
import { pushWithCapacity } from './undoCapacity'

describe('pushWithCapacity', () => {
  test('empty stack + push → [item], length 1', () => {
    const result = pushWithCapacity([], 'a', 5)
    expect(result).toEqual(['a'])
    expect(result.length).toBe(1)
  })

  test('capacity 5, 5 items + push 6th → items 2–6 (oldest dropped)', () => {
    const stack = ['a', 'b', 'c', 'd', 'e']
    const result = pushWithCapacity(stack, 'f', 5)
    expect(result).toEqual(['b', 'c', 'd', 'e', 'f'])
    expect(result.length).toBe(5)
  })

  test('capacity 5, 4 items + push → 5 items (no eviction)', () => {
    const stack = ['a', 'b', 'c', 'd']
    const result = pushWithCapacity(stack, 'e', 5)
    expect(result).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(result.length).toBe(5)
  })

  test('capacity 0 → always returns [] (item immediately evicted)', () => {
    // Edge case: capacity 0 means no undo history kept at all.
    const result = pushWithCapacity([], 'x', 0)
    expect(result).toEqual([])
  })

  test('capacity 0 with existing stack → still returns []', () => {
    const result = pushWithCapacity(['a', 'b'], 'c', 0)
    expect(result).toEqual([])
  })

  test('capacity 1 keeps only the latest item', () => {
    const result = pushWithCapacity(['old'], 'new', 1)
    expect(result).toEqual(['new'])
  })

  test('does not mutate the original stack', () => {
    const original = ['a', 'b', 'c']
    const frozen = Object.freeze([...original]) as readonly string[]
    pushWithCapacity(frozen, 'd', 5)
    expect([...frozen]).toEqual(['a', 'b', 'c'])
  })
})
