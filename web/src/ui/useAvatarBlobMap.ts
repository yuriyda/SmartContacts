/**
 * @file useAvatarBlobMap.ts
 * Returns a Map<contactId, blob:URL> for every cached avatar in the local
 * database. Drives thumbnail rendering in the contact-list rows so each row
 * can show its real photo instead of just initials.
 *
 * Lifecycle:
 *  - On mount: bulk-load all rows via runtime.listAvatarBlobs().
 *  - On `google-contacts-sync-changed`: full refresh (revoke all old URLs,
 *    re-materialise from DB). Sync may have added/removed many rows.
 *  - On `google-contacts-avatar-saved`: targeted refresh — single
 *    getAvatarBlob lookup, add/replace the one URL. Avoids the all-rebuild
 *    cost when the user opens contacts one by one.
 *  - On unmount or runtime change: revoke every object URL to avoid leaks.
 *
 * Rules:
 *  - Returns empty Map when runtime is null (Google sync not wired).
 *  - Map identity changes on every mutation so React re-renders consumers.
 *  - Never throws — fail-soft on DB hiccups.
 */

import { useEffect, useState } from 'react'
import type { GoogleSyncRuntime } from '@smart-contacts/shared'
import { AVATAR_SAVED_EVENT, type AvatarSavedDetail } from './useContactAvatar'

const EMPTY: ReadonlyMap<string, string> = new Map()
const SYNC_CHANGED_EVENT = 'google-contacts-sync-changed'

function bytesToObjectUrl(bytes: Uint8Array, mime: string): string {
  // Cast through unknown to satisfy strict-lib SharedArrayBuffer typing.
  const blob = new Blob([bytes as unknown as ArrayBuffer], { type: mime })
  return URL.createObjectURL(blob)
}

export function useAvatarBlobMap(
  runtime: GoogleSyncRuntime | null | undefined,
): ReadonlyMap<string, string> {
  const [map, setMap] = useState<ReadonlyMap<string, string>>(EMPTY)

  useEffect(() => {
    if (runtime === null || runtime === undefined) {
      setMap(EMPTY)
      return
    }

    let cancelled = false
    // Mutable working copy we manage in the effect closure. We push every URL
    // we create into `liveUrls` so cleanup can revoke each one exactly once.
    let liveUrls = new Set<string>()
    let working = new Map<string, string>()

    const publish = (): void => {
      if (cancelled) return
      // Hand React a fresh Map identity so memoised consumers re-render.
      setMap(new Map(working))
    }

    const replaceUrl = (contactId: string, newUrl: string): void => {
      const old = working.get(contactId)
      if (old !== undefined) {
        URL.revokeObjectURL(old)
        liveUrls.delete(old)
      }
      working.set(contactId, newUrl)
      liveUrls.add(newUrl)
    }

    const fullRefresh = async (): Promise<void> => {
      try {
        const rows = await runtime.listAvatarBlobs()
        if (cancelled) return
        // Revoke every URL from the prior snapshot before rebuilding.
        for (const url of liveUrls) URL.revokeObjectURL(url)
        liveUrls = new Set<string>()
        working = new Map<string, string>()
        for (const r of rows) {
          const url = bytesToObjectUrl(r.blob, r.mime)
          working.set(r.contactId, url)
          liveUrls.add(url)
        }
        publish()
      } catch {
        /* fail-soft — keep whatever we had before */
      }
    }

    const onAvatarSaved = (e: Event): void => {
      const detail = (e as CustomEvent<AvatarSavedDetail>).detail
      if (detail === null || detail === undefined) return
      const { contactId } = detail
      void (async () => {
        try {
          const row = await runtime.getAvatarBlob(contactId)
          if (cancelled || row === null) return
          const url = bytesToObjectUrl(row.blob, row.mime)
          replaceUrl(contactId, url)
          publish()
        } catch {
          /* fail-soft */
        }
      })()
    }

    void fullRefresh()
    window.addEventListener(SYNC_CHANGED_EVENT, fullRefresh)
    window.addEventListener(AVATAR_SAVED_EVENT, onAvatarSaved)

    return () => {
      cancelled = true
      window.removeEventListener(SYNC_CHANGED_EVENT, fullRefresh)
      window.removeEventListener(AVATAR_SAVED_EVENT, onAvatarSaved)
      for (const url of liveUrls) URL.revokeObjectURL(url)
      liveUrls = new Set<string>()
      working = new Map<string, string>()
    }
  }, [runtime])

  return map
}
