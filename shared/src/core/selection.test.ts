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
  test('single click on empty selection → set = {id1}; cursor = id1; anchor = id1', () => {
    const result = applyMultiSelect(
      { prev: new Set(), anchor: null, id: 'id1', orderedIds: IDS },
      'single',
    )
    expect([...result.next]).toEqual(['id1'])
    expect(result.nextCursor).toBe('id1')
    expect(result.nextAnchor).toBe('id1')
  })

  test('single click replaces existing selection; cursor + anchor both move', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id1', 'id2']), anchor: 'id1', id: 'id3', orderedIds: IDS },
      'single',
    )
    expect([...result.next]).toEqual(['id3'])
    expect(result.nextCursor).toBe('id3')
    expect(result.nextAnchor).toBe('id3')
  })
})

describe('applyMultiSelect — toggle mode', () => {
  test('toggle empty → adds id; cursor + anchor = id', () => {
    const result = applyMultiSelect(
      { prev: new Set(), anchor: null, id: 'id2', orderedIds: IDS },
      'toggle',
    )
    expect(result.next.has('id2')).toBe(true)
    expect(result.nextCursor).toBe('id2')
    expect(result.nextAnchor).toBe('id2')
  })

  test('toggle on existing id → removes; cursor + anchor both update', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id1', 'id2']), anchor: 'id1', id: 'id2', orderedIds: IDS },
      'toggle',
    )
    expect(result.next.has('id2')).toBe(false)
    expect(result.next.has('id1')).toBe(true)
    expect(result.nextCursor).toBe('id2')
    expect(result.nextAnchor).toBe('id2')
  })

  test('toggle on absent id → adds it', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id1']), anchor: 'id1', id: 'id3', orderedIds: IDS },
      'toggle',
    )
    expect(result.next.has('id3')).toBe(true)
    expect(result.next.has('id1')).toBe(true)
    expect(result.nextCursor).toBe('id3')
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
    expect(result.nextCursor).toBe('id3')
    expect(result.nextAnchor).toBe('id3')
  })

  test('range with anchor not in orderedIds → falls back to single', () => {
    const result = applyMultiSelect(
      { prev: new Set(), anchor: 'unknown', id: 'id2', orderedIds: IDS },
      'range',
    )
    expect([...result.next]).toEqual(['id2'])
    expect(result.nextCursor).toBe('id2')
    expect(result.nextAnchor).toBe('id2')
  })

  test('range from id1 to id3 → set = {id1, id2, id3}; cursor = id3; anchor STAYS at id1', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id1']), anchor: 'id1', id: 'id3', orderedIds: IDS },
      'range',
    )
    expect([...result.next].sort()).toEqual(['id1', 'id2', 'id3'])
    expect(result.nextCursor).toBe('id3')
    expect(result.nextAnchor).toBe('id1')
  })

  test('range from id3 to id1 (reverse) → same set; cursor = id1; anchor STAYS at id3', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id3']), anchor: 'id3', id: 'id1', orderedIds: IDS },
      'range',
    )
    expect([...result.next].sort()).toEqual(['id1', 'id2', 'id3'])
    expect(result.nextCursor).toBe('id1')
    expect(result.nextAnchor).toBe('id3')
  })

  test('successive Shift+Clicks expand from same anchor', () => {
    // First Shift+Click: anchor=id1, click id3 → range id1..id3
    const r1 = applyMultiSelect(
      { prev: new Set(['id1']), anchor: 'id1', id: 'id3', orderedIds: IDS },
      'range',
    )
    expect(r1.nextAnchor).toBe('id1')
    // Second Shift+Click on id4 with anchor STILL id1 → range id1..id4
    const r2 = applyMultiSelect(
      { prev: r1.next, anchor: r1.nextAnchor, id: 'id4', orderedIds: IDS },
      'range',
    )
    expect([...r2.next].sort()).toEqual(['id1', 'id2', 'id3', 'id4'])
    expect(r2.nextAnchor).toBe('id1')
  })

  test('range with target id NOT in orderedIds → falls back to single', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id1']), anchor: 'id1', id: 'unknown', orderedIds: IDS },
      'range',
    )
    expect([...result.next]).toEqual(['unknown'])
    expect(result.nextCursor).toBe('unknown')
    expect(result.nextAnchor).toBe('unknown')
  })

  test('range with same start and end → single element set; anchor stays', () => {
    const result = applyMultiSelect(
      { prev: new Set(['id2']), anchor: 'id2', id: 'id2', orderedIds: IDS },
      'range',
    )
    expect([...result.next]).toEqual(['id2'])
    expect(result.nextCursor).toBe('id2')
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
