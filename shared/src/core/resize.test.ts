/**
 * @file resize.test.ts
 * Unit tests for clampWidth and computeNewWidth in resize.ts.
 * Run under vitest (shared package). No DOM required.
 */

import { describe, test, expect } from 'vitest'
import { clampWidth, computeNewWidth } from './resize'

// ---------------------------------------------------------------------------
// clampWidth
// ---------------------------------------------------------------------------

describe('clampWidth', () => {
  test('returns value when inside range', () => {
    expect(clampWidth(300, 180, 480)).toBe(300)
  })

  test('clamps to min when below', () => {
    expect(clampWidth(100, 180, 480)).toBe(180)
  })

  test('clamps to max when above', () => {
    expect(clampWidth(600, 180, 480)).toBe(480)
  })

  test('returns min when value equals min (exact boundary)', () => {
    expect(clampWidth(180, 180, 480)).toBe(180)
  })

  test('returns max when value equals max (exact boundary)', () => {
    expect(clampWidth(480, 180, 480)).toBe(480)
  })

  test('zero delta: value unchanged', () => {
    expect(clampWidth(224, 180, 480)).toBe(224)
  })
})

// ---------------------------------------------------------------------------
// computeNewWidth — left edge (sidebar)
// ---------------------------------------------------------------------------

describe('computeNewWidth – left edge', () => {
  test('positive delta grows panel', () => {
    expect(computeNewWidth(224, 50, 'left', 180, 480)).toBe(274)
  })

  test('negative delta shrinks panel', () => {
    // 300 - 50 = 250, still within [180, 480]
    expect(computeNewWidth(300, -50, 'left', 180, 480)).toBe(250)
  })

  test('zero delta returns same width', () => {
    expect(computeNewWidth(224, 0, 'left', 180, 480)).toBe(224)
  })

  test('clamps to min when delta would go below min', () => {
    expect(computeNewWidth(200, -100, 'left', 180, 480)).toBe(180)
  })

  test('clamps to max when delta would exceed max', () => {
    expect(computeNewWidth(450, 100, 'left', 180, 480)).toBe(480)
  })

  test('exact min boundary respected', () => {
    expect(computeNewWidth(180, 0, 'left', 180, 480)).toBe(180)
  })

  test('exact max boundary respected', () => {
    expect(computeNewWidth(480, 0, 'left', 180, 480)).toBe(480)
  })
})

// ---------------------------------------------------------------------------
// computeNewWidth — right edge (detail panel)
// ---------------------------------------------------------------------------

describe('computeNewWidth – right edge', () => {
  test('positive delta shrinks panel (mirror behavior)', () => {
    expect(computeNewWidth(384, 50, 'right', 240, 640)).toBe(334)
  })

  test('negative delta grows panel', () => {
    expect(computeNewWidth(384, -50, 'right', 240, 640)).toBe(434)
  })

  test('zero delta returns same width', () => {
    expect(computeNewWidth(384, 0, 'right', 240, 640)).toBe(384)
  })

  test('clamps to min when delta would go below min', () => {
    expect(computeNewWidth(260, 100, 'right', 240, 640)).toBe(240)
  })

  test('clamps to max when delta would exceed max', () => {
    expect(computeNewWidth(600, -100, 'right', 240, 640)).toBe(640)
  })
})
