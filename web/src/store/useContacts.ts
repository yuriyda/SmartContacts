// useContacts hook: subscribes to a refresh-version counter; mutations bump the counter
// to trigger re-queries. This is a deliberately simple alternative to a full store
// (Zustand/Jotai) — sufficient for P2 because all writes go through the repo.
// Rules: no UI imports; only React primitives and @smart-contacts/shared types.
import { useCallback, useEffect, useState } from 'react'
import type { Contact, ContactsRepo, Ulid } from '@smart-contacts/shared'

export interface UseContactsResult {
  contacts: Contact[]
  loading: boolean
  refresh: () => void
  // Mutations:
  upsert: (c: Contact) => Promise<Contact | null>
  softDelete: (id: Ulid) => Promise<void>
  restore: (id: Ulid) => Promise<void>
  touch: (id: Ulid) => Promise<void>
  bulkLoad: (cs: Contact[]) => Promise<void>
}

export function useContacts(repo: ContactsRepo | null): UseContactsResult {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!repo) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const list = await repo.list({ includeDeleted: true })
      if (!cancelled) {
        setContacts(list)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [repo, version])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const upsert = useCallback(
    async (c: Contact) => {
      if (!repo) return null
      const out = await repo.upsert(c)
      refresh()
      return out
    },
    [repo, refresh],
  )

  const softDelete = useCallback(
    async (id: Ulid) => {
      if (!repo) return
      await repo.softDelete(id)
      refresh()
    },
    [repo, refresh],
  )

  const restore = useCallback(
    async (id: Ulid) => {
      if (!repo) return
      await repo.restore(id)
      refresh()
    },
    [repo, refresh],
  )

  const touch = useCallback(
    async (id: Ulid) => {
      if (!repo) return
      await repo.touch(id)
      refresh()
    },
    [repo, refresh],
  )

  const bulkLoad = useCallback(
    async (cs: Contact[]) => {
      if (!repo) return
      await repo.bulkLoad(cs)
      refresh()
    },
    [repo, refresh],
  )

  return { contacts, loading, refresh, upsert, softDelete, restore, touch, bulkLoad }
}
