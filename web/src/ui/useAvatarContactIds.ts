/**
 * @file useAvatarContactIds.ts
 * Returns a Set of contact IDs for which Google's snapshot declares a photo
 * (regardless of whether the bytes have been fetched locally yet). Drives
 * the small "photo present" marker next to the Google badge in each list
 * row.
 *
 * Implementation: a single one-shot SELECT against snapshots on mount;
 * refreshed automatically after a sync run via the existing
 * `google-contacts-sync-changed` window event.
 *
 * Rules:
 *  - Returns empty Set when runtime is null (Google sync not wired).
 *  - Set identity changes on every refresh so React re-renders consumers.
 *  - Never throws — fail-soft on DB hiccups.
 */

import { useEffect, useState } from 'react'
import type { GoogleSyncRuntime } from '@smart-contacts/shared'

const EMPTY: ReadonlySet<string> = new Set()
const SYNC_CHANGED_EVENT = 'google-contacts-sync-changed'

export function useAvatarContactIds(
  runtime: GoogleSyncRuntime | null | undefined,
): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(EMPTY)

  useEffect(() => {
    if (runtime === null || runtime === undefined) {
      setIds(EMPTY)
      return
    }

    let cancelled = false

    const refresh = async (): Promise<void> => {
      try {
        const list = await runtime.listGooglePhotoContactIds()
        if (cancelled) return
        setIds(new Set(list))
      } catch {
        // Soft-fail: empty set means no markers, which is the safe default.
      }
    }

    void refresh()
    window.addEventListener(SYNC_CHANGED_EVENT, refresh)

    return () => {
      cancelled = true
      window.removeEventListener(SYNC_CHANGED_EVENT, refresh)
    }
  }, [runtime])

  return ids
}
