/**
 * @file useUndoableActions.ts
 * Wraps user-driven mutations with the UndoStore recorder.
 * Sync ingestions MUST bypass this layer (call repos directly via shared/sync/sync.ts).
 * Spec §20.
 *
 * Rules:
 *  - Each method records the appropriate UndoAction kind via store.push().
 *  - applyUndo / applyRedo walk a single action and apply the inverse semantics.
 *  - applyUndo MUST NOT itself record (else infinite loop). Internal calls use the
 *    underlying mutators directly.
 *  - No nested DB transactions — mutations delegate to existing repo-level hooks.
 */
import { useCallback } from 'react'
import type { Contact, Interaction, ContactTask, Ulid } from '@smart-contacts/shared'
import type { UndoAction, UndoStore } from './undoStore'

export interface UndoableDeps {
  contacts: Contact[]
  upsert: (c: Contact) => Promise<Contact | null>
  softDelete: (id: Ulid) => Promise<void>
  restore: (id: Ulid) => Promise<void>
  // touch sets lastContactedAt = now on the existing contact.
  // Undo reads the contact from `contacts` BEFORE the call to capture prev.
  touch: (id: Ulid) => Promise<void>
  upsertInteraction: (i: Interaction) => Promise<void>
  softDeleteInteraction: (id: Ulid) => Promise<void>
  upsertTask: (t: ContactTask) => Promise<void>
  markTaskDone: (id: Ulid, doneAt: string) => Promise<void>
  reopenTask: (id: Ulid) => Promise<void>
  softDeleteTask: (id: Ulid) => Promise<void>
  // Read interactions/tasks for undo restore-after-delete cases:
  getInteraction: (id: Ulid) => Interaction | undefined
  getTask: (id: Ulid) => ContactTask | undefined
  store: UndoStore
}

export function useUndoableActions(deps: UndoableDeps) {
  const {
    contacts,
    upsert,
    softDelete,
    restore,
    touch,
    upsertInteraction,
    softDeleteInteraction,
    upsertTask,
    markTaskDone,
    reopenTask,
    softDeleteTask,
    getInteraction,
    getTask,
    store,
  } = deps

  // -------------------------------------------------------------------------
  // Recorders — call mutator then push the corresponding UndoAction.
  // -------------------------------------------------------------------------

  const recordCreate = useCallback(
    async (c: Contact) => {
      const out = await upsert(c)
      store.push({ kind: 'create', contact: out ?? c })
    },
    [upsert, store],
  )

  const recordEdit = useCallback(
    async (before: Contact, after: Contact) => {
      const out = await upsert(after)
      store.push({ kind: 'edit', before, after: out ?? after })
    },
    [upsert, store],
  )

  const recordSoftDelete = useCallback(
    async (id: string) => {
      const before = contacts.find((c) => c.id === id)
      if (!before) return
      await softDelete(id)
      store.push({ kind: 'softDelete', contact: before })
    },
    [contacts, softDelete, store],
  )

  const recordRestore = useCallback(
    async (id: string) => {
      await restore(id)
      store.push({ kind: 'restore', id })
    },
    [restore, store],
  )

  const recordTouch = useCallback(
    async (id: string) => {
      const c = contacts.find((x) => x.id === id)
      const prev = c?.lastContactedAt ?? undefined
      await touch(id)
      store.push({ kind: 'touch', id, prevLastContactedAt: prev })
    },
    [contacts, touch, store],
  )

  const recordToggleFlag = useCallback(
    async (c: Contact, field: 'hidden' | 'protected') => {
      const prev = c[field] ?? false
      const next = !prev
      await upsert({ ...c, [field]: next })
      store.push({ kind: 'flagToggle', id: c.id, field, prev, next })
    },
    [upsert, store],
  )

  const recordInteractionUpsert = useCallback(
    async (after: Interaction) => {
      const before = getInteraction(after.id) ?? null
      await upsertInteraction(after)
      store.push({ kind: 'interactionUpsert', before, after })
    },
    [getInteraction, upsertInteraction, store],
  )

  const recordInteractionSoftDelete = useCallback(
    async (id: string) => {
      const interaction = getInteraction(id)
      if (!interaction) return
      await softDeleteInteraction(id)
      store.push({ kind: 'interactionSoftDelete', interaction })
    },
    [getInteraction, softDeleteInteraction, store],
  )

  const recordTaskUpsert = useCallback(
    async (after: ContactTask) => {
      const before = getTask(after.id) ?? null
      await upsertTask(after)
      store.push({ kind: 'taskUpsert', before, after })
    },
    [getTask, upsertTask, store],
  )

  const recordTaskMarkDone = useCallback(
    async (id: string, doneAt: string) => {
      const t = getTask(id)
      const prev = t?.doneAt
      await markTaskDone(id, doneAt)
      store.push({ kind: 'taskMarkDone', id, prevDoneAt: prev })
    },
    [getTask, markTaskDone, store],
  )

  const recordTaskReopen = useCallback(
    async (id: string) => {
      const t = getTask(id)
      const prev = t?.doneAt ?? ''
      await reopenTask(id)
      store.push({ kind: 'taskReopen', id, prevDoneAt: prev })
    },
    [getTask, reopenTask, store],
  )

  const recordTaskSoftDelete = useCallback(
    async (id: string) => {
      const t = getTask(id)
      if (!t) return
      await softDeleteTask(id)
      store.push({ kind: 'taskSoftDelete', task: t })
    },
    [getTask, softDeleteTask, store],
  )

  // Bulk: caller assembles per-row UndoActions, then calls recordBulk to wrap composite.
  const recordBulk = useCallback(
    (children: UndoAction[]) => {
      if (children.length === 0) return
      store.push({ kind: 'bulk', children })
    },
    [store],
  )

  // -------------------------------------------------------------------------
  // applyUndo — reverses a single action WITHOUT recording (no infinite loop).
  // -------------------------------------------------------------------------

  const applyUndo = useCallback(
    async (action: UndoAction): Promise<void> => {
      switch (action.kind) {
        case 'create':
          await softDelete(action.contact.id)
          return
        case 'softDelete':
          await restore(action.contact.id)
          // Re-upsert to preserve lastContactedAt and all original fields
          await upsert({ ...action.contact })
          return
        case 'restore':
          await softDelete(action.id)
          return
        case 'edit':
          await upsert(action.before)
          return
        case 'touch': {
          const c = contacts.find((x) => x.id === action.id)
          if (!c) return
          const next: Contact = { ...c }
          if (action.prevLastContactedAt === undefined) {
            delete (next as unknown as Record<string, unknown>)['lastContactedAt']
          } else {
            next.lastContactedAt = action.prevLastContactedAt
          }
          await upsert(next)
          return
        }
        case 'flagToggle': {
          const c = contacts.find((x) => x.id === action.id)
          if (!c) return
          await upsert({ ...c, [action.field]: action.prev })
          return
        }
        case 'interactionUpsert':
          if (action.before === null) {
            await softDeleteInteraction(action.after.id)
          } else {
            await upsertInteraction(action.before)
          }
          return
        case 'interactionSoftDelete':
          await upsertInteraction(action.interaction)
          return
        case 'taskUpsert':
          if (action.before === null) {
            await softDeleteTask(action.after.id)
          } else {
            await upsertTask(action.before)
          }
          return
        case 'taskMarkDone':
          if (action.prevDoneAt === undefined) {
            await reopenTask(action.id)
          } else {
            await markTaskDone(action.id, action.prevDoneAt)
          }
          return
        case 'taskReopen':
          await markTaskDone(action.id, action.prevDoneAt)
          return
        case 'taskSoftDelete':
          await upsertTask(action.task)
          return
        case 'bulk':
          // Apply children in REVERSE order
          for (let i = action.children.length - 1; i >= 0; i--) {
            await applyUndo(action.children[i]!)
          }
          return
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      contacts,
      upsert,
      softDelete,
      restore,
      upsertInteraction,
      softDeleteInteraction,
      upsertTask,
      markTaskDone,
      reopenTask,
      softDeleteTask,
    ],
  )

  // -------------------------------------------------------------------------
  // applyRedo — re-applies the "after" state of an action WITHOUT recording.
  // -------------------------------------------------------------------------

  const applyRedo = useCallback(
    async (action: UndoAction): Promise<void> => {
      switch (action.kind) {
        case 'create':
          await upsert(action.contact)
          return
        case 'softDelete':
          await softDelete(action.contact.id)
          return
        case 'restore':
          await restore(action.id)
          return
        case 'edit':
          await upsert(action.after)
          return
        case 'touch': {
          const c = contacts.find((x) => x.id === action.id)
          if (!c) return
          await touch(action.id)
          return
        }
        case 'flagToggle': {
          const c = contacts.find((x) => x.id === action.id)
          if (!c) return
          await upsert({ ...c, [action.field]: action.next })
          return
        }
        case 'interactionUpsert':
          await upsertInteraction(action.after)
          return
        case 'interactionSoftDelete':
          await softDeleteInteraction(action.interaction.id)
          return
        case 'taskUpsert':
          await upsertTask(action.after)
          return
        case 'taskMarkDone':
          // Redo: mark done with NOW (original timestamp is not preserved — acceptable trade-off).
          await markTaskDone(action.id, new Date().toISOString())
          return
        case 'taskReopen':
          await reopenTask(action.id)
          return
        case 'taskSoftDelete':
          await softDeleteTask(action.task.id)
          return
        case 'bulk':
          for (const child of action.children) await applyRedo(child)
          return
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      contacts,
      upsert,
      softDelete,
      restore,
      touch,
      upsertInteraction,
      softDeleteInteraction,
      upsertTask,
      markTaskDone,
      reopenTask,
      softDeleteTask,
    ],
  )

  return {
    recordCreate,
    recordEdit,
    recordSoftDelete,
    recordRestore,
    recordTouch,
    recordToggleFlag,
    recordInteractionUpsert,
    recordInteractionSoftDelete,
    recordTaskUpsert,
    recordTaskMarkDone,
    recordTaskReopen,
    recordTaskSoftDelete,
    recordBulk,
    applyUndo,
    applyRedo,
  }
}
