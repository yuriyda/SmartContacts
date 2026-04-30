/**
 * @file common.tsx
 * Shared presentational primitives: ConfirmDialog, Toast, ToastContainer, SectionDivider, EmptyState.
 * Modeled after TaskOrchestrator/tauri-app/src/ui/common.tsx.
 * Rules: no DB access; only React primitives and context. Keep components self-contained.
 */
import { useEffect, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { X, AlertTriangle } from './icons'
import { useApp } from './AppContext'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { TC, t } = useApp()
  const confirmCls = destructive
    ? 'bg-red-600 hover:bg-red-500 text-white'
    : 'bg-sky-600 hover:bg-sky-500 text-white'

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onConfirm, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className={`border rounded-xl shadow-2xl p-6 w-80 ${TC.surface} ${TC.borderClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className={`text-sm font-semibold mb-2 ${TC.text}`}>{title}</h2>
        <p className={`text-sm mb-5 ${TC.textSec}`}>{body}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${TC.elevated} ${TC.textSec}`}
          >
            {cancelLabel ?? t('actions.cancel')}
            <kbd
              className={`ml-2 text-xs px-1 py-0.5 rounded font-mono leading-none opacity-60 ${TC.surface}`}
            >
              Esc
            </kbd>
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${confirmCls}`}
          >
            {confirmLabel ?? t('actions.confirm')}
            <kbd className="ml-2 text-xs bg-white/10 text-white/80 px-1 py-0.5 rounded font-mono leading-none">
              ↵
            </kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

export interface ToastProps {
  id: string
  message: string
  action?: { label: string; onClick: () => void }
  duration?: number
  onDismiss: () => void
}

export function Toast(p: ToastProps) {
  const { TC } = useApp()

  useEffect(() => {
    const timer = setTimeout(p.onDismiss, p.duration ?? 5000)
    return () => clearTimeout(timer)
  }, [p.duration, p.onDismiss])

  return (
    <div
      className={`flex items-center gap-3 border px-4 py-2.5 rounded-lg shadow-xl text-sm ${TC.surface} ${TC.borderClass} ${TC.text}`}
    >
      <span className="flex-1">{p.message}</span>
      {p.action && (
        <button
          onClick={p.action.onClick}
          className="text-sky-400 hover:text-sky-300 text-xs font-medium flex-shrink-0"
        >
          {p.action.label}
        </button>
      )}
      <button
        onClick={p.onDismiss}
        className={`flex-shrink-0 ${TC.textMuted} hover:${TC.textSec}`}
        aria-label="dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export interface ToastContainerProps {
  toasts: Array<Omit<ToastProps, 'onDismiss'>>
  onDismiss: (id: string) => void
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-auto">
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  )
}

export function SectionDivider({
  label,
  count,
  onClick,
}: {
  label: string
  count?: number
  onClick?: () => void
}) {
  const { TC } = useApp()
  return (
    <div
      className={`flex items-center gap-2.5 py-0.5${onClick ? ' cursor-pointer group' : ''}`}
      onClick={onClick}
    >
      <span
        className={`text-xs font-semibold uppercase tracking-widest flex items-center gap-1.5 ${TC.textMuted}${onClick ? ' group-hover:opacity-80' : ''}`}
      >
        <AlertTriangle size={11} />
        {label}
        {count !== undefined && (
          <span
            className={`text-xs font-normal normal-case tracking-normal px-1.5 py-0.5 rounded-full ${TC.elevated} ${TC.textSec}`}
          >
            {count}
          </span>
        )}
      </span>
      <div className={`flex-1 h-px border-t ${TC.borderClass}`} />
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon?: LucideIcon
  title: string
  body?: string
}) {
  const { TC } = useApp()
  return (
    <div className="flex flex-col items-center gap-3 py-12 px-6 text-center">
      {Icon && <Icon size={40} />}
      <p className={`text-sm font-medium ${TC.textSec}`}>{title}</p>
      {body && <p className={`text-xs ${TC.textMuted}`}>{body}</p>}
    </div>
  )
}

// Re-export for convenience so consumers can import everything from common.
export type { ReactNode, LucideIcon }
