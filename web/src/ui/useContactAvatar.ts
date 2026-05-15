/**
 * @file useContactAvatar.ts
 * Lazy on-demand avatar loader for a single open contact.
 *
 * Behavior:
 *  - Immediately renders any locally cached avatar from the `avatars` table.
 *  - If absent and the contact is linked to Google, schedules a debounced
 *    fetch (300ms) via GoogleSyncRuntime.fetchAvatarOnDemand.
 *  - Returns a blob: URL ready to feed into <img src>.
 *  - On unmount / contactId change, cancels the pending fetch and revokes
 *    the previous object URL to avoid leaks.
 *
 * Safety layers (defense in depth against CDN per-IP rate limits):
 *  1. 300ms React debounce — quick-clicking through contacts only fetches the
 *     one that stays selected for ≥300ms.
 *  2. Runtime-level in-flight dedup keyed by contactId.
 *  3. Runtime-level 60s global circuit breaker after any HTTP 429.
 *  4. maxRetries=0 inside downloadPhoto — single shot, no backoff spam.
 */

import { useEffect, useState } from 'react'
import type { GoogleSyncRuntime } from '@smart-contacts/shared'

/** Debounce window before firing the remote fetch when the contact has no local avatar. */
const LAZY_FETCH_DEBOUNCE_MS = 300

/**
 * Window event fired after a lazy fetch successfully stored a fresh avatar in
 * the `avatars` table. The list view subscribes so the row’s photo appears
 * without waiting for the next full sync.
 */
export const AVATAR_SAVED_EVENT = 'google-contacts-avatar-saved'
export interface AvatarSavedDetail {
  contactId: string
}

export function useContactAvatar(
  runtime: GoogleSyncRuntime | null | undefined,
  contactId: string | null | undefined,
  googleResourceName: string | null | undefined,
): string | null {
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)

  useEffect(() => {
    // Reset whenever inputs change — never show the previous contact's photo.
    setPhotoDataUrl(null)

    if (runtime === null || runtime === undefined) return
    if (contactId === null || contactId === undefined || contactId === '') return

    let cancelled = false
    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    let currentObjectUrl: string | undefined

    const publishUrl = (url: string): void => {
      if (cancelled) {
        URL.revokeObjectURL(url)
        return
      }
      if (currentObjectUrl !== undefined) URL.revokeObjectURL(currentObjectUrl)
      currentObjectUrl = url
      setPhotoDataUrl(url)
    }

    const renderFromDb = async (): Promise<boolean> => {
      const row = await runtime.getAvatarBlob(contactId)
      if (cancelled || row === null) return row !== null
      // Some SQL adapters hand back number[] for BLOB — normalize defensively.
      const bytes =
        row.blob instanceof Uint8Array
          ? row.blob
          : new Uint8Array(row.blob as unknown as ArrayLike<number>)
      // Cast through unknown to satisfy TS strict-lib SharedArrayBuffer typing.
      const blob = new Blob([bytes as unknown as ArrayBuffer], { type: row.mime })
      publishUrl(URL.createObjectURL(blob))
      return true
    }

    void (async () => {
      const hadLocal = await renderFromDb()
      if (hadLocal || cancelled) return
      if (
        googleResourceName === null ||
        googleResourceName === undefined ||
        googleResourceName === ''
      ) {
        return
      }

      debounceTimer = setTimeout(() => {
        void (async () => {
          if (cancelled) return
          const status = await runtime.fetchAvatarOnDemand(contactId, googleResourceName)
          if (cancelled || status !== 'ok') return
          await renderFromDb()
          // Let list-view consumers (useAvatarBlobMap) pick up the newly
          // cached photo without a full sync round-trip.
          const detail: AvatarSavedDetail = { contactId }
          window.dispatchEvent(new CustomEvent(AVATAR_SAVED_EVENT, { detail }))
        })()
      }, LAZY_FETCH_DEBOUNCE_MS)
    })()

    return () => {
      cancelled = true
      if (debounceTimer !== undefined) clearTimeout(debounceTimer)
      if (currentObjectUrl !== undefined) URL.revokeObjectURL(currentObjectUrl)
    }
  }, [runtime, contactId, googleResourceName])

  return photoDataUrl
}
