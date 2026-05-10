/**
 * @file selection.ts
 * Pure helpers for the multi-select selection model in MainList.
 * Spec §19.1. Modeled after TaskOrchestrator/tauri-app/src/hooks/useTaskActions.ts.
 *
 * Three logical positions per selection state:
 *  - cursor: the currently active row (drives detail-view target + arrow nav).
 *  - anchor: the start of a Shift-extended range; stable across Shift+Click.
 *  - set:    the multi-select set.
 *
 * Modes:
 *  - 'single':  click → set = {id}; cursor = id; anchor = id.
 *  - 'toggle':  Ctrl/Cmd+Click → set XOR id; cursor = id; anchor = id.
 *  - 'range':   Shift+Click → set = range(anchor, id); cursor = id; ANCHOR UNCHANGED.
 *               If anchor is missing/invalid, falls back to 'single'.
 *
 * The anchor-stable-on-range rule lets the user perform successive Shift+Clicks
 * to expand or contract a range from a fixed starting point.
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
  /** New cursor (active row). Always equals the clicked id. */
  nextCursor: string
  /** New range anchor. For 'single'/'toggle' = id; for 'range' = unchanged input anchor. */
  nextAnchor: string
}

export function applyMultiSelect(input: SelectionInput, mode: SelectionMode): SelectionResult {
  const { prev, anchor, id, orderedIds } = input

  if (mode === 'single') {
    return { next: new Set([id]), nextCursor: id, nextAnchor: id }
  }

  if (mode === 'toggle') {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { next, nextCursor: id, nextAnchor: id }
  }

  // range: anchor must be valid; otherwise degrade to single.
  if (!anchor || !orderedIds.includes(anchor)) {
    return { next: new Set([id]), nextCursor: id, nextAnchor: id }
  }
  const a = orderedIds.indexOf(anchor)
  const b = orderedIds.indexOf(id)
  if (b === -1) return { next: new Set([id]), nextCursor: id, nextAnchor: id }
  const [from, to] = a < b ? [a, b] : [b, a]
  const slice = orderedIds.slice(from, to + 1)
  return { next: new Set(slice), nextCursor: id, nextAnchor: anchor }
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
