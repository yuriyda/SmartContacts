/**
 * @file useNetworkData.ts
 * Read-only hook that loads recent interactions (last 90 days) and all open contact_tasks.
 * Used by the NetworkDashboard widgets. Active only when activeView === 'network'.
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
