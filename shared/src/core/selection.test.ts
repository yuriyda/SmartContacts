/**
 * @file selection.test.ts
 * Unit tests for the pure multi-select helpers: applyMultiSelect and modeFromEvent.
 * Spec §19.1.
 * Rules: no React, no DOM.
 */

import { describe, test, expect } from 'vitest'
import { applyMultiSelect, modeFromEvent } from './selection'

const IDS = ['id1', 'id2', 'id3', 'id4']

describe('applyMultiSelect — single mode', () => {
  test('single click on empty selection → set = {id1}; anchor = id1', () => {
    const result = applyMultiSelect(
      { prev: new Set(), anchor: null, id: 'id1', orderedIds: IDS },
      'single',
    )
    expect([...result.next]).toEqual(['id1'])
    expect(result.nextAnchor).toBe('id1')
  })

  test('single click replaces existing selection', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id1', 'id2']), anchor: 'id1', id: 'id3', orderedIds: IDS },
      'single',
    )
    expect([...result.next]).toEqual(['id3'])
    expect(result.nextAnchor).toBe('id3')
  })
})

describe('applyMultiSelect — toggle mode', () => {
  test('toggle empty → adds id; anchor = id', () => {
    const result = applyMultiSelect(
      { prev: new Set(), anchor: null, id: 'id2', orderedIds: IDS },
      'toggle',
    )
    expect(result.next.has('id2')).toBe(true)
    expect(result.nextAnchor).toBe('id2')
  })

  test('toggle on existing id → removes; anchor still updated', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id1', 'id2']), anchor: 'id1', id: 'id2', orderedIds: IDS },
      'toggle',
    )
    expect(result.next.has('id2')).toBe(false)
    expect(result.next.has('id1')).toBe(true)
    expect(result.nextAnchor).toBe('id2')
  })

  test('toggle on absent id → adds it', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id1']), anchor: 'id1', id: 'id3', orderedIds: IDS },
      'toggle',
    )
    expect(result.next.has('id3')).toBe(true)
    expect(result.next.has('id1')).toBe(true)
    expect(result.nextAnchor).toBe('id3')
  })
})

describe('applyMultiSelect — range mode', () => {
  test('range with no anchor → falls back to single', () => {
    const result = applyMultiSelect(
      { prev: new Set(), anchor: null, id: 'id3', orderedIds: IDS },
      'range',
    )
    expect([...result.next]).toEqual(['id3'])
    expect(result.nextAnchor).toBe('id3')
  })

  test('range with anchor not in orderedIds → falls back to single', () => {
    const result = applyMultiSelect(
      { prev: new Set(), anchor: 'unknown', id: 'id2', orderedIds: IDS },
      'range',
    )
    expect([...result.next]).toEqual(['id2'])
    expect(result.nextAnchor).toBe('id2')
  })

  test('range from id1 to id3 → set = {id1, id2, id3}; anchor = id3', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id1']), anchor: 'id1', id: 'id3', orderedIds: IDS },
      'range',
    )
    expect([...result.next].sort()).toEqual(['id1', 'id2', 'id3'])
    expect(result.nextAnchor).toBe('id3')
  })

  test('range from id3 to id1 (reverse) → same set; anchor = id1', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id3']), anchor: 'id3', id: 'id1', orderedIds: IDS },
      'range',
    )
    expect([...result.next].sort()).toEqual(['id1', 'id2', 'id3'])
    expect(result.nextAnchor).toBe('id1')
  })

  test('range with target id NOT in orderedIds → falls back to single', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id1']), anchor: 'id1', id: 'unknown', orderedIds: IDS },
      'range',
    )
    expect([...result.next]).toEqual(['unknown'])
    expect(result.nextAnchor).toBe('unknown')
  })

  test('range with same start and end → single element set', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id2']), anchor: 'id2', id: 'id2', orderedIds: IDS },
      'range',
    )
    expect([...result.next]).toEqual(['id2'])
    expect(result.nextAnchor).toBe('id2')
  })
})

describe('modeFromEvent', () => {
  test('shift takes priority over ctrl/meta → range', () => {
    expect(modeFromEvent({ shiftKey: true, ctrlKey: true, metaKey: true })).toBe('range')
    expect(modeFromEvent({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe('range')
  })

  test('ctrl without shift → toggle', () => {
    expect(modeFromEvent({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe('toggle')
  })

  test('meta without shift → toggle', () => {
    expect(modeFromEvent({ shiftKey: false, ctrlKey: false, metaKey: true })).toBe('toggle')
  })

  test('no modifier → single', () => {
    expect(modeFromEvent({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe('single')
  })
})
