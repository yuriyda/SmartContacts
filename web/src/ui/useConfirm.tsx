/**
 * @file useConfirm.tsx
 * Promise-based wrapper around <ConfirmDialog>. Hook returns:
 *  - `confirm(opts)`: Promise<boolean> — resolves true on Confirm, false on Cancel/Esc/backdrop.
 *  - `Mount`: ReactNode — render exactly once high in the tree (e.g. SmartContactsApp root).
 *
 * Rules:
 *  - Replaces window.confirm calls. Native confirm freezes Chrome under WSL and is unstyled.
 *  - Single in-flight prompt at a time; calling confirm() while one is open replaces it.
 *  - No DB access; pure UI.
 */
import { useCallback, useState, type ReactNode } from 'react'
import { ConfirmDialog } from './common'

export interface ConfirmOptions {
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

interface PendingState {
  opts: ConfirmOptions
  resolve: (v: boolean) => void
}

export interface UseConfirmResult {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  Mount: ReactNode
}

export function useConfirm(): UseConfirmResult {
  const [pending, setPending] = useState<PendingState | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ opts, resolve })
    })
  }, [])

  const onConfirm = useCallback(() => {
    pending?.resolve(true)
    setPending(null)
  }, [pending])

  const onCancel = useCallback(() => {
    pending?.resolve(false)
    setPending(null)
  }, [pending])

  const Mount: ReactNode = pending ? (
    <ConfirmDialog
      open
      title={pending.opts.title}
      body={pending.opts.body}
      {...(pending.opts.confirmLabel !== undefined
        ? { confirmLabel: pending.opts.confirmLabel }
        : {})}
      {...(pending.opts.cancelLabel !== undefined ? { cancelLabel: pending.opts.cancelLabel } : {})}
      {...(pending.opts.destructive !== undefined ? { destructive: pending.opts.destructive } : {})}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  ) : null

  return { confirm, Mount }
}
