/**
 * @file useNetworkData.ts
 * Read-only hook that loads recent interactions (last 90 days) and all open contact_tasks.
 * Used by the NetworkDashboard widgets. Active only when activeView === 'network'.
 *
 * Also exports useOpenTasks — a lightweight hook that always loads open tasks regardless
 * of active view. Used by the notification scheduler so it can fire even when the user
 * is on the Contacts view.
 *
 * Rules: no writes — read-only data fetch on mount + on `version` bump.
 */
import { useEffect, useMemo, useState } from 'react'
import type {
  Interaction,
  ContactTask,
  InteractionsRepo,
  ContactTasksRepo,
} from '@smart-contacts/shared'

interface Result {
  recentInteractions: Interaction[]
  openTasks: ContactTask[]
  loading: boolean
  reload: () => void
}

export function useNetworkData(
  interactionsRepo: InteractionsRepo | null,
  tasksRepo: ContactTasksRepo | null,
  enabled: boolean,
): Result {
  const [recentInteractions, setRecentInteractions] = useState<Interaction[]>([])
  const [openTasks, setOpenTasks] = useState<ContactTask[]>([])
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !interactionsRepo || !tasksRepo) return
    let cancelled = false
    setLoading(true)
    const since = new Date(Date.now() - 90 * 86400000).toISOString()
    void (async () => {
      const [ints, tasks] = await Promise.all([
        interactionsRepo.recentSince(since),
        tasksRepo.listAllOpen(),
      ])
      if (!cancelled) {
        setRecentInteractions(ints)
        setOpenTasks(tasks)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [interactionsRepo, tasksRepo, enabled, version])

  const reload = useMemo(() => () => setVersion((v) => v + 1), [])

  return { recentInteractions, openTasks, loading, reload }
}

/**
 * Thin hook: always loads open tasks when tasksRepo is available.
 * Used by notification scheduler to have task data regardless of active view.
 */
export function useOpenTasks(tasksRepo: ContactTasksRepo | null): ContactTask[] {
  const [openTasks, setOpenTasks] = useState<ContactTask[]>([])

  useEffect(() => {
    if (!tasksRepo) return
    let cancelled = false
    void (async () => {
      const tasks = await tasksRepo.listAllOpen()
      if (!cancelled) setOpenTasks(tasks)
    })()
    return () => {
      cancelled = true
    }
  }, [tasksRepo])

  return openTasks
}
