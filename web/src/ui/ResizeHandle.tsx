/**
 * @file ResizeHandle.tsx
 * Drag handle for resizing panels (Sidebar or ContactDetail) in the desktop layout.
 *
 * Purpose: Renders a 4 px wide vertical bar that the user can drag to resize an adjacent panel.
 * On touch devices, returns null — resizing is desktop-only (mobile parity deferred to P6).
 *
 * Edit rules:
 *  - Keep touch detection as a module-level const so it is evaluated once.
 *  - Do NOT add dependency on AppContext; this is purely presentational + pointer logic.
 *  - Math (delta → new width) is delegated to computeNewWidth from @smart-contacts/shared.
 *  - Pointer capture is NOT used; move/up listeners are attached to `document` instead.
 */
import { useRef } from 'react'
import { computeNewWidth } from '@smart-contacts/shared'

// Feature-detect touch devices once at module load.
const IS_TOUCH =
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResizeHandleProps {
  /** Current width of the panel being resized (px). */
  width: number
  /** Called on every pointer move during a drag. */
  onResize: (newWidth: number) => void
  /** Called when the user releases the pointer — persist the final width here. */
  onCommit: (finalWidth: number) => void
  /** Minimum allowed width (px). */
  min: number
  /** Maximum allowed width (px). */
  max: number
  /**
   * 'left'  — handle sits on the RIGHT edge of a left-anchored panel (Sidebar).
   *            Dragging right increases the panel width.
   * 'right' — handle sits on the LEFT edge of a right-anchored panel (Detail).
   *            Dragging right decreases the panel width.
   */
  edge: 'left' | 'right'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResizeHandle({
  width,
  onResize,
  onCommit,
  min,
  max,
  edge,
}: ResizeHandleProps): JSX.Element | null {
  // Drag state stored in a ref so pointer callbacks close over stable values.
  // Must be declared before any conditional return to satisfy Rules of Hooks.
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  // Do not render on touch devices (hook already called above).
  if (IS_TOUCH) return null

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Only primary button (left mouse / pen).
    if (e.button !== 0) return
    e.preventDefault()

    dragRef.current = { startX: e.clientX, startWidth: width }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: PointerEvent) {
      if (!dragRef.current) return
      const delta = ev.clientX - dragRef.current.startX
      const newWidth = computeNewWidth(dragRef.current.startWidth, delta, edge, min, max)
      onResize(newWidth)
    }

    function onUp(ev: PointerEvent) {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)

      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      if (dragRef.current) {
        const delta = ev.clientX - dragRef.current.startX
        const finalWidth = computeNewWidth(dragRef.current.startWidth, delta, edge, min, max)
        dragRef.current = null
        onCommit(finalWidth)
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  // Render as a flex-item sibling between panels (NOT absolute) — the parent
  // row is flex with static children, so absolute positioning would anchor to
  // the row's outer edges instead of between panels. A 4 px-wide flex item
  // with a faint baseline background sits naturally on the boundary.
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="w-1 flex-shrink-0 cursor-col-resize bg-slate-500/30 hover:bg-sky-500/60 transition-colors z-10"
      onPointerDown={handlePointerDown}
    />
  )
}
