/**
 * @file useInteractions.ts
 * Per-contact interaction list + mutations. Reloads when contactId changes
 * or when a mutation bumps the internal version counter.
 * Rules: no UI imports.
 */
import { useCallback, useEffect, useState, useMemo } from 'react'
import type { Interaction, InteractionsRepo, Ulid } from '@smart-contacts/shared'

export interface UseInteractionsResult {
  interactions: Interaction[] // sorted by at DESC, alive only
  loading: boolean
  upsert: (i: Interaction) => Promise<void>
  softDelete: (id: Ulid) => Promise<void>
  reload: () => void
}

export function useInteractions(
  repo: InteractionsRepo | null,
  contactId: Ulid | null,
): UseInteractionsResult {
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [loading, setLoading] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!repo || !contactId) {
      setInteractions([])
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const list = await repo.list(contactId)
      if (!cancelled) {
        setInteractions(list)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repo, contactId, version])

  const reload = useMemo(() => () => setVersion((v) => v + 1), [])

  const upsert = useCallback(
    async (i: Interaction) => {
      if (!repo) return
      await repo.upsert(i)
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

  return { interactions, loading, upsert, softDelete, reload }
}
