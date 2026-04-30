/**
 * @file useToasts.ts
 * Tiny imperative toast manager: returns { toasts, push, dismiss }.
 * Toasts auto-dismiss via timer in the Toast component (common.tsx);
 * this hook owns the list and id generation only.
 * Rules: no DB access; pure React state. Do not add side effects beyond state management.
 */
import { useCallback, useState } from 'react'
import { ulid } from '@smart-contacts/shared'

interface Toast {
  id: string
  message: string
  action?: { label: string; onClick: () => void }
  duration?: number
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback(
    (message: string, opts?: { action?: Toast['action']; duration?: number }) => {
      const id = ulid()
      const entry: Toast = { id, message }
      if (opts?.action !== undefined) entry.action = opts.action
      if (opts?.duration !== undefined) entry.duration = opts.duration
      setToasts((prev) => [...prev, entry])
      return id
    },
    [],
  )

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, push, dismiss }
}
