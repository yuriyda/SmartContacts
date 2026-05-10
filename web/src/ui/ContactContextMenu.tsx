/**
 * @file ContactContextMenu.tsx
 * Right-click context menu for contact rows. Adapted from TaskOrchestrator's
 * /workspace/TaskOrchestrator-main/tauri-app/src/ui/ContextMenu.tsx — same
 * close-on-outside / Escape / scroll behavior, viewport clamping, and onMouseDown
 * action wiring (so the row's pending mousedown doesn't steal focus).
 *
 * Single-vs-multi selection: when the right-clicked row is part of a multi-set
 * (selectedIds.size > 1 AND selectedIds.has(targetId)) the menu acts on every
 * id in the set; otherwise it acts on just the target row.
 *
 * Rules: presentational only — no DB access. Receives mutators as props from
 * SmartContactsApp which threads them through useUndoableActions so undo works.
 * Trash scope offers Restore in place of Delete (caller decides via `inTrash`).
 */
import { useEffect, useRef, useState } from 'react'
import type { Contact } from '@smart-contacts/shared'
import { useApp } from './AppContext'

export interface ContactContextMenuProps {
  x: number
  y: number
  contact: Contact
  selectedIds: ReadonlySet<string>
  /** Caller indicates trash scope so we offer Restore instead of Delete. */
  inTrash: boolean
  onClose: () => void
  onOpenDetail: (id: string) => void
  onEdit: (id: string) => void
  onTouch: (ids: ReadonlySet<string>) => void
  onToggleHidden: (ids: ReadonlySet<string>) => void
  onToggleProtected: (ids: ReadonlySet<string>) => void
  onDelete: (ids: ReadonlySet<string>) => void
  onRestore: (ids: ReadonlySet<string>) => void
}

export function ContactContextMenu({
  x,
  y,
  contact,
  selectedIds,
  inTrash,
  onClose,
  onOpenDetail,
  onEdit,
  onTouch,
  onToggleHidden,
  onToggleProtected,
  onDelete,
  onRestore,
}: ContactContextMenuProps) {
  const { TC, t } = useApp()
  const ref = useRef<HTMLDivElement | null>(null)

  // Single-vs-multi: only treat as multi when the right-click target is part of
  // an existing multi-selection. A right-click on a row that's NOT in the set
  // acts on just that row (matches OS file-manager convention).
  const isMulti = selectedIds.size > 1 && selectedIds.has(contact.id)
  const ids: ReadonlySet<string> = isMulti ? selectedIds : new Set([contact.id])
  const n = ids.size

  // Close on outside-click, Escape, or any scroll. Mirrors TO ContextMenu.tsx:38-50.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onScroll = () => onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  // Clamp to viewport — flips left/up when the menu would overflow the right or bottom edge.
  const [pos, setPos] = useState({ left: x, top: y })
  useEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    setPos({
      left: x + rect.width > vw ? Math.max(0, vw - rect.width - 8) : x,
      top: y + rect.height > vh ? Math.max(0, vh - rect.height - 8) : y,
    })
  }, [x, y])

  // Item: uses onMouseDown (not onClick) and preventDefault — so the mousedown
  // doesn't bubble and re-trigger the row's selection logic, and the action
  // fires before the row's pending click.
  const Item = ({
    label,
    onAct,
    danger = false,
  }: {
    label: string
    onAct: () => void
    danger?: boolean
  }) => (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onAct()
        onClose()
      }}
      className={`w-full text-left px-3 py-1.5 text-sm rounded transition-colors ${
        danger ? 'text-red-400 hover:bg-red-500/10' : `${TC.text} hover:bg-sky-500/10`
      }`}
    >
      {label}
    </button>
  )

  const Sep = ({ id }: { id: string }) => (
    <div key={id} className={`my-1 border-t ${TC.borderClass}`} />
  )

  // Aggregate flag info across the selection to label the toggle correctly.
  // For multi-select the menu still shows toggle items; the underlying mutator
  // decides per-contact whether to flip — labels just describe intent.
  const allHidden = isMulti ? false : !!contact.hidden
  const allProtected = isMulti ? false : !!contact.protected

  return (
    <div
      ref={ref}
      className={`fixed z-50 ${TC.surface} border ${TC.borderClass} rounded-lg shadow-2xl py-1 px-1`}
      style={{ left: pos.left, top: pos.top, minWidth: 200, maxWidth: 280 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {isMulti && (
        <>
          <div className={`px-3 py-1.5 text-xs font-semibold tracking-wide ${TC.textMuted}`}>
            {t('ctx.selected_count').replace('{n}', String(n))}
          </div>
          <Sep id="s0" />
        </>
      )}

      {!isMulti && (
        <>
          <Item label={t('ctx.open')} onAct={() => onOpenDetail(contact.id)} />
          <Item label={t('ctx.edit')} onAct={() => onEdit(contact.id)} />
          <Sep id="s1" />
        </>
      )}

      {!inTrash && (
        <>
          <Item label={t('ctx.touch')} onAct={() => onTouch(ids)} />
          <Item
            label={allHidden ? t('ctx.unhide') : t('ctx.hide')}
            onAct={() => onToggleHidden(ids)}
          />
          <Item
            label={allProtected ? t('ctx.unprotect') : t('ctx.protect')}
            onAct={() => onToggleProtected(ids)}
          />
          <Sep id="s2" />
        </>
      )}

      {inTrash ? (
        <Item label={t('ctx.restore')} onAct={() => onRestore(ids)} />
      ) : (
        <Item
          label={isMulti ? t('ctx.delete_selected') : t('ctx.delete')}
          onAct={() => onDelete(ids)}
          danger
        />
      )}
    </div>
  )
}
