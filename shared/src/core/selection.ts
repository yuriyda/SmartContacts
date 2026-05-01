/**
 * @file selection.ts
 * Pure helpers for the multi-select selection model in MainList.
 * Spec §19.1.
 *
 * Modes:
 *  - 'single':  click → replaces selection with [id]; anchor = id.
 *  - 'toggle':  Ctrl/Cmd+Click → toggles id in set; anchor = id.
 *  - 'range':   Shift+Click → replaces selection with the range from anchor to id (inclusive).
 *
 * Rules: no React, no DOM. ID order preserved as in `orderedIds`.
 */

export type SelectionMode = 'single' | 'toggle' | 'range'

export interface SelectionInput {
  prev: ReadonlySet<string>
  anchor: string | null
  id: string
  orderedIds: ReadonlyArray<string>
}

export interface SelectionResult {
  next: Set<string>
  nextAnchor: string
}

export function applyMultiSelect(input: SelectionInput, mode: SelectionMode): SelectionResult {
  const { prev, anchor, id, orderedIds } = input

  if (mode === 'single') {
    return { next: new Set([id]), nextAnchor: id }
  }

  if (mode === 'toggle') {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { next, nextAnchor: id }
  }

  // range
  if (!anchor || !orderedIds.includes(anchor)) {
    return { next: new Set([id]), nextAnchor: id }
  }
  const a = orderedIds.indexOf(anchor)
  const b = orderedIds.indexOf(id)
  if (b === -1) return { next: new Set([id]), nextAnchor: id }
  const [from, to] = a < b ? [a, b] : [b, a]
  const slice = orderedIds.slice(from, to + 1)
  return { next: new Set(slice), nextAnchor: id }
}

/**
 * Detect mode from a MouseEvent.
 *  - shiftKey → 'range' (takes priority over Ctrl/Meta)
 *  - ctrlKey or metaKey → 'toggle'
 *  - else → 'single'
 */
export function modeFromEvent(e: {
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}): SelectionMode {
  if (e.shiftKey) return 'range'
  if (e.ctrlKey || e.metaKey) return 'toggle'
  return 'single'
}
