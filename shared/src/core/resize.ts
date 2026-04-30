/**
 * @file resize.ts
 * Pure math helpers for drag-handle panel resizing.
 *
 * Purpose: Provide framework-independent clamp and delta-to-width computation
 * so that ResizeHandle.tsx can import deterministic, testable functions.
 *
 * Edit rules:
 *  - Keep this file free of DOM / React dependencies.
 *  - All exported functions must be pure (no side effects).
 *  - Tests live in resize.test.ts; update them whenever the contract changes.
 */

/**
 * Clamp `value` to the inclusive range [min, max].
 */
export function clampWidth(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * Compute the new panel width after a pointer drag.
 *
 * @param startWidth  Width of the panel at drag-start (px).
 * @param deltaPx     Horizontal pointer movement since drag-start (px). Positive = rightward.
 * @param edge        'left'  — handle is on the RIGHT edge of a left-anchored panel (e.g. Sidebar):
 *                              dragging right expands the panel → newWidth = startWidth + delta.
 *                    'right' — handle is on the LEFT edge of a right-anchored panel (e.g. Detail):
 *                              dragging right compresses the panel → newWidth = startWidth - delta.
 * @param min         Minimum allowed width (px).
 * @param max         Maximum allowed width (px).
 */
export function computeNewWidth(
  startWidth: number,
  deltaPx: number,
  edge: 'left' | 'right',
  min: number,
  max: number,
): number {
  const raw = edge === 'left' ? startWidth + deltaPx : startWidth - deltaPx
  return clampWidth(raw, min, max)
}
