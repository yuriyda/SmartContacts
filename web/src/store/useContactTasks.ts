/**
 * @file useContactTasks.ts
 * Per-contact task list + mutations. Reloads when contactId changes
 * or when a mutation bumps the internal version counter.
 * Rules: no UI imports. Mirror of useInteractions.ts for the tasks domain.
 */
import { useCallback, useEffect, useState, useMemo } from 'react'
import type { ContactTask, ContactTasksRepo, Ulid } from '@smart-contacts/shared'

export interface UseContactTasksResult {
  /** Alive tasks only, sorted: open first then by dueAt ASC NULLS LAST then priority ASC. */
  tasks: ContactTask[]
  loading: boolean
  upsert: (t: ContactTask) => Promise<void>
  markDone: (id: Ulid, doneAt: string) => Promise<void>
  reopen: (id: Ulid) => Promise<void>
  softDelete: (id: Ulid) => Promise<void>
  reload: () => void
}

export function useContactTasks(
  repo: ContactTasksRepo | null,
  contactId: Ulid | null,
): UseContactTasksResult {
  const [tasks, setTasks] = useState<ContactTask[]>([])
  const [loading, setLoading] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!repo || !contactId) {
      setTasks([])
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const list = await repo.list(contactId)
      if (!cancelled) {
        setTasks(list)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repo, contactId, version])

  const reload = useMemo(() => () => setVersion((v) => v + 1), [])

  const upsert = useCallback(
    async (t: ContactTask) => {
      if (!repo) return
      await repo.upsert(t)
      reload()
    },
    [repo, reload],
  )

  const markDone = useCallback(
    async (id: Ulid, doneAt: string) => {
      if (!repo) return
      await repo.markDone(id, doneAt)
      reload()
    },
    [repo, reload],
  )

  const reopen = useCallback(
    async (id: Ulid) => {
      if (!repo) return
      await repo.reopen(id)
      reload()
    },
    [repo, reload],
  )

  const softDelete = useCallback(
    async (id: Ulid) => {
      if (!repo) return
      await repo.softDelete(id)
      reload()
    },
    [repo, reload],
  )

  return { tasks, loading, upsert, markDone, reopen, softDelete, reload }
}
