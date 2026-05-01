/**
 * @file undoStore.ts
 * Session-only Undo / Redo stack — capacity 5, no persistence, no sync awareness.
 * Spec §20.1–20.3.
 *
 * Rules:
 *  - Pushed only by user actions in the current tab. Sync ingestions bypass.
 *  - New push exceeding capacity drops the oldest.
 *  - Any push clears the redo (future) stack.
 *  - This module is a typed React state hook — no DB writes here.
 *  - Callers read past[past.length - 1] BEFORE calling popUndo/popRedo
 *    to avoid async setState closure pitfalls.
 */
import { useState, useCallback } from 'react'
import type { Contact, Interaction, ContactTask } from '@smart-contacts/shared'
import { pushWithCapacity } from '@smart-contacts/shared'

export type UndoAction =
  | { kind: 'create'; contact: Contact }
  | { kind: 'softDelete'; contact: Contact }
  | { kind: 'restore'; id: string }
  | { kind: 'edit'; before: Contact; after: Contact }
  | { kind: 'touch'; id: string; prevLastContactedAt: string | undefined }
  | { kind: 'flagToggle'; id: string; field: 'hidden' | 'protected'; prev: boolean; next: boolean }
  | { kind: 'interactionUpsert'; before: Interaction | null; after: Interaction }
  | { kind: 'interactionSoftDelete'; interaction: Interaction }
  | { kind: 'taskUpsert'; before: ContactTask | null; after: ContactTask }
  | { kind: 'taskMarkDone'; id: string; prevDoneAt: string | undefined }
  | { kind: 'taskReopen'; id: string; prevDoneAt: string }
  | { kind: 'taskSoftDelete'; task: ContactTask }
  | { kind: 'bulk'; children: UndoAction[] } // composite for §19

export interface UndoStore {
  past: UndoAction[]
  future: UndoAction[]
  /**
   * Push a new action. Exceeding CAPACITY evicts the oldest. Clears redo stack.
   */
  push: (action: UndoAction) => void
  /**
   * Remove the last entry from past and push it to future.
   * Caller must read past[past.length - 1] BEFORE calling this.
   */
  popUndo: () => void
  /**
   * Remove the last entry from future and push it to past.
   * Caller must read future[future.length - 1] BEFORE calling this.
   */
  popRedo: () => void
  clear: () => void
}

const CAPACITY = 5

export function useUndoStore(): UndoStore {
  const [past, setPast] = useState<UndoAction[]>([])
  const [future, setFuture] = useState<UndoAction[]>([])

  const push = useCallback((action: UndoAction) => {
    setPast((prev) => pushWithCapacity(prev, action, CAPACITY))
    setFuture([])
  }, [])

  const popUndo = useCallback(() => {
    setPast((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]!
      setFuture((f) => [...f, last])
      return prev.slice(0, -1)
    })
  }, [])

  const popRedo = useCallback(() => {
    setFuture((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]!
      setPast((p) => [...p, last])
      return prev.slice(0, -1)
    })
  }, [])

  const clear = useCallback(() => {
    setPast([])
    setFuture([])
  }, [])

  return { past, future, push, popUndo, popRedo, clear }
}
