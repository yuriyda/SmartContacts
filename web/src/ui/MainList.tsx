/**
 * @file MainList.tsx
 * Scrollable contacts list. Renders ContactRow for each visible contact.
 *
 * Layout: the outer listbox has horizontal+vertical padding (px-3 py-2) so a
 * small empty gutter exists around the rows. The marquee selection starts
 * ONLY from a mousedown in that gutter — mousedown on a row falls through to
 * the row's HTML5 DnD (draggable="true") which moves the contact onto sidebar
 * groups/tags. Mirrors TaskOrchestrator/tauri-app/src/TaskOrchestrator.tsx:462
 * (`<main className="... p-6 space-y-4" onMouseDown={...}>`) which closes over
 * `closest("[data-task-id]")` early-return — without that early-return, native
 * DnD wins on every mousedown and marquee can never activate.
 *
 * Once the cursor moves >5px from the gutter mousedown, rows are selected by
 * bbox-intersection via the data-contact-id attribute. Ctrl/Shift held during
 * drag = additive (union with snapshot of selectedIds at mousedown). Plain
 * click in the gutter without drag clears the selection (TO parity).
 * Disabled on touch devices.
 *
 * Keyboard nav (arrows, Home/End, etc.) is wired GLOBALLY via useKeyboard in
 * SmartContactsApp (matching TO's hooks/useKeyboard.ts). The container has
 * tabIndex={0} so Tab-only keyboard users can enter the list and arrow-key.
 *
 * Rules: no DB access; receives already-filtered contacts from parent.
 * Do NOT add row-level keyboard handlers here — they live in the global hook.
 */
import { forwardRef, useRef, useState } from 'react'
import type { Contact } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { ContactRow } from './ContactRow'
import { EmptyState } from './common'
import { isTouchDevice } from './dnd'
import { Users } from 'lucide-react'

interface MainListProps {
  contacts: Contact[]
  selectedId: string | null
  selectedIds: ReadonlySet<string>
  /** Called on mouse click — receives event for multi-select mode detection. */
  onSelect: (id: string, e: React.MouseEvent) => void
  /** Called when checkbox is clicked — always toggles regardless of modifiers. */
  onToggleSelection: (id: string, e: React.MouseEvent) => void
  /**
   * Called by marquee drag-rect with the new full selection set.
   * Caller is responsible for any cursor / anchor updates (typically untouched).
   */
  onMarqueeSelect: (next: Set<string>) => void
  /** Right-click on a row — caller opens a context menu at viewport coords. */
  onContextMenu: (id: string, e: React.MouseEvent) => void
  onTouch: (id: string) => void
  onSoftDelete: (id: string) => void
  onOpenEdit: (id: string) => void
  loading: boolean
}

interface DragState {
  startX: number
  startY: number
  /** mousedown target — used by onUp to detect "click on empty area" → clear selection. */
  downTarget: HTMLElement
  snapshot: Set<string>
  additive: boolean
  active: boolean
}

interface DragOverlay {
  left: number
  top: number
  width: number
  height: number
}

const MARQUEE_THRESHOLD_PX = 5

export const MainList = forwardRef<HTMLDivElement, MainListProps>(function MainList(
  {
    contacts,
    selectedId,
    selectedIds,
    onSelect,
    onToggleSelection,
    onMarqueeSelect,
    onContextMenu,
    onTouch,
    onSoftDelete,
    onOpenEdit,
    loading,
  },
  ref,
) {
  const { TC, t } = useApp()

  // Local ref so the marquee can read the container's bounding rect even when the
  // parent forwards its own ref. setRefs merges both.
  const localRef = useRef<HTMLDivElement | null>(null)
  const setRefs = (node: HTMLDivElement | null) => {
    localRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
  }

  const dragRef = useRef<DragState | null>(null)
  const [overlay, setOverlay] = useState<DragOverlay | null>(null)

  function onContainerMouseDown(e: React.MouseEvent) {
    // Only left-button. Touch devices: skip entirely (matches DnD policy).
    if (isTouchDevice || e.button !== 0) return
    const target = e.target as HTMLElement
    // Mousedown ON a row → fall through to HTML5 DnD. We never start marquee
    // from a row, otherwise native drag-start fires before we've crossed the
    // 5px threshold and DnD wins every time. The row's draggable="true" still
    // works because we don't touch the event here.
    if (target.closest('[data-contact-id]')) return
    // Interactive form elements have their own handlers.
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.tagName === 'A') return
    // Skip when starting on the scrollbar gutter.
    const container = localRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (e.clientX > rect.right - 16) return

    // We're in the gutter — suppress text selection during the rubber-band.
    e.preventDefault()

    // Modifier keys (Ctrl/Shift) make the marquee additive — selection is
    // (snapshot ∪ touched). Plain marquee replaces the snapshot.
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      downTarget: target,
      snapshot: new Set(selectedIds),
      additive: e.ctrlKey || e.metaKey || e.shiftKey,
      active: false,
    }

    const onMove = (ev: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = ev.clientX - drag.startX
      const dy = ev.clientY - drag.startY
      if (!drag.active && Math.hypot(dx, dy) < MARQUEE_THRESHOLD_PX) return
      // Threshold passed — switch into marquee mode.
      if (!drag.active) {
        drag.active = true
        // Suppress native text-selection: clear any in-progress selection and
        // disable user-select on the body for the duration of the drag.
        document.getSelection()?.removeAllRanges()
        document.body.style.userSelect = 'none'
      }

      const minX = Math.min(drag.startX, ev.clientX)
      const maxX = Math.max(drag.startX, ev.clientX)
      const minY = Math.min(drag.startY, ev.clientY)
      const maxY = Math.max(drag.startY, ev.clientY)

      // Hit-test rows by bbox intersection with the drag rect (viewport coords).
      // Container-scoped query so we never grab rows outside this list.
      const rows = container.querySelectorAll<HTMLElement>('[data-contact-id]')
      const touched = new Set<string>()
      for (const row of rows) {
        const r = row.getBoundingClientRect()
        if (r.right >= minX && r.left <= maxX && r.bottom >= minY && r.top <= maxY) {
          const id = row.dataset.contactId
          if (id) touched.add(id)
        }
      }

      const next = drag.additive ? new Set<string>([...drag.snapshot, ...touched]) : touched
      onMarqueeSelect(next)

      // Convert to container-local coords for the overlay so it stays put when
      // the list scrolls (overlay is rendered as an absolutely-positioned child).
      const containerRect = container.getBoundingClientRect()
      setOverlay({
        left: minX - containerRect.left + container.scrollLeft,
        top: minY - containerRect.top + container.scrollTop,
        width: maxX - minX,
        height: maxY - minY,
      })
    }

    const onUp = () => {
      const drag = dragRef.current
      const wasActive = !!drag?.active
      const downTarget = drag?.downTarget ?? null
      const additive = !!drag?.additive
      dragRef.current = null
      setOverlay(null)
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (wasActive) {
        // Suppress the trailing click event so row.onClick doesn't fire and
        // overwrite the selection we just produced by dragging.
        const blockClick = (clickEv: MouseEvent) => {
          clickEv.stopPropagation()
          clickEv.preventDefault()
        }
        window.addEventListener('click', blockClick, { capture: true, once: true })
      } else if (!additive && downTarget && !downTarget.closest('[data-contact-id]')) {
        // No drag, no modifiers, mousedown was outside any row → clear selection
        // (matches TaskOrchestrator's click-on-empty-area behavior).
        onMarqueeSelect(new Set())
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (loading) {
    return <div className={`flex-1 p-6 ${TC.surface} ${TC.textSec}`}>{t('status.loading')}</div>
  }

  if (contacts.length === 0) {
    return (
      <div className={`flex-1 flex items-center justify-center ${TC.surface}`}>
        <EmptyState icon={Users} title={t('empty.no_contacts')} body={t('empty.demo_hint')} />
      </div>
    )
  }

  return (
    <div
      ref={setRefs}
      // px-6 py-4 creates the gutter where marquee can start. Without it the
      // rows go edge-to-edge inside the listbox and there's nowhere to mousedown
      // outside a row — DnD always wins. See TaskOrchestrator <main p-6 space-y-4>.
      className={`flex-1 overflow-y-auto ${TC.surface} focus:outline-none relative px-6 py-4`}
      // tabIndex=0 so Tab-only keyboard users can enter the list, then arrow.
      // Marquee programmatic focus still works at this value.
      tabIndex={0}
      role="listbox"
      aria-label="Contacts list"
      aria-multiselectable="true"
      data-list-keys
      onMouseDown={onContainerMouseDown}
    >
      {contacts.map((c) => (
        <ContactRow
          key={c.id}
          contact={c}
          selected={c.id === selectedId}
          multiSelected={selectedIds.has(c.id)}
          anySelected={selectedIds.size > 0}
          onSelect={(e) => onSelect(c.id, e)}
          onToggleSelection={(e) => onToggleSelection(c.id, e)}
          onContextMenu={(id, e) => onContextMenu(id, e)}
          onTouch={() => onTouch(c.id)}
          onSoftDelete={() => onSoftDelete(c.id)}
          onOpenEdit={onOpenEdit}
        />
      ))}
      {overlay && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: overlay.left,
            top: overlay.top,
            width: overlay.width,
            height: overlay.height,
            pointerEvents: 'none',
            background: 'rgba(14,165,233,0.10)',
            border: '1px dashed rgb(56,189,248)',
            zIndex: 10,
          }}
        />
      )}
    </div>
  )
})
