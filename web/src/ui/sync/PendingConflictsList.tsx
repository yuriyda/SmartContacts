/**
 * @file PendingConflictsList.tsx
 * Displays a paginated list of pending sync conflicts grouped by contact.
 * Each card shows the contact display name, count of conflicting fields,
 * comma-separated field labels, and a "Resolve →" button that opens
 * ConflictResolutionModal (T20).
 *
 * RO-INVARIANT INV-5: this component never writes to the conflict queue.
 * All write operations (resolve, etc.) are delegated to the caller via
 * onResolveContact(). This file is read-only with respect to DB state.
 *
 * Rules:
 *  - No direct DB access — data flows through ConflictRepo passed as prop.
 *  - No bulk-resolve-all buttons.
 *  - Sort order: newest detected_at first (guaranteed by ConflictRepo.listPending).
 *  - Pagination: pageSize (default 20) contacts per page.
 */

import { useEffect, useState, useMemo } from 'react'
import type { ConflictRepo, ConflictRow } from '@smart-contacts/shared'
import { useApp } from '../AppContext'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One grouped entry shown as a card in the list. */
interface ContactConflictGroup {
  contactId: string
  displayName: string
  fieldPaths: string[]
  /** ISO-8601 string of the most-recent detected_at across all fields. */
  latestDetectedAt: string
}

export interface PendingConflictsListProps {
  conflictRepo: ConflictRepo
  /** Map from contactId → display name; injected so list can show human-readable names. */
  contactNameById: Map<string, string>
  /** Called when user clicks "Resolve →"; should open ConflictResolutionModal (T20). */
  onResolveContact: (contactId: string) => void
  /** Number of contact cards shown per page. Default: 20. */
  pageSize?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group a flat array of ConflictRows by contactId, preserving newest-first order. */
function groupByContact(
  rows: ConflictRow[],
  nameById: Map<string, string>,
): ContactConflictGroup[] {
  // Rows are already ordered newest-first from listPending (ORDER BY detected_at DESC).
  // We want to preserve the order of first appearance of each contactId.
  const order: string[] = []
  const map = new Map<string, ContactConflictGroup>()

  for (const row of rows) {
    if (!map.has(row.contactId)) {
      order.push(row.contactId)
      map.set(row.contactId, {
        contactId: row.contactId,
        displayName: nameById.get(row.contactId) ?? row.contactId,
        fieldPaths: [],
        latestDetectedAt: row.detectedAt,
      })
    }
    const group = map.get(row.contactId)!
    if (!group.fieldPaths.includes(row.fieldPath)) {
      group.fieldPaths.push(row.fieldPath)
    }
    // Keep the latest detectedAt across all rows for this contact.
    if (row.detectedAt > group.latestDetectedAt) {
      group.latestDetectedAt = row.detectedAt
    }
  }

  return order.map((id) => map.get(id)!)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PendingConflictsList({
  conflictRepo,
  contactNameById,
  onResolveContact,
  pageSize = 20,
}: PendingConflictsListProps) {
  const { TC } = useApp()

  const [conflicts, setConflicts] = useState<ConflictRow[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  // Fetch all pending conflicts once on mount.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void conflictRepo.listPending().then((rows: ConflictRow[]) => {
      if (cancelled) return
      setConflicts(rows)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [conflictRepo])

  // Re-group whenever raw rows or name map changes.
  const allGroups = useMemo(
    () => groupByContact(conflicts, contactNameById),
    [conflicts, contactNameById],
  )

  const totalCount = allGroups.length
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  // Clamp page when groups shrink (e.g. after external refresh).
  const safePage = Math.min(page, totalPages - 1)

  const pageGroups = useMemo(
    () => allGroups.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [allGroups, safePage, pageSize],
  )

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-10 text-sm ${TC.textMuted}`}>
        Loading conflicts…
      </div>
    )
  }

  if (totalCount === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-14 gap-2 text-sm ${TC.textMuted}`}
      >
        <span className="text-2xl">✓</span>
        <span>No pending conflicts.</span>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Main list
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-3">
      {/* Contact cards */}
      {pageGroups.map((group) => (
        <div
          key={group.contactId}
          className={`flex items-center justify-between rounded-lg border px-4 py-3 gap-4 ${TC.elevated} ${TC.borderClass}`}
        >
          {/* Left: name + field summary */}
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className={`font-medium truncate ${TC.text}`}>
              {group.displayName}
              <span className={`ml-2 text-sm font-normal ${TC.textMuted}`}>
                — {group.fieldPaths.length}{' '}
                {group.fieldPaths.length === 1 ? 'conflict' : 'conflicts'}
              </span>
            </span>
            <span className={`text-xs truncate ${TC.textMuted}`}>
              {group.fieldPaths.join(', ')}
            </span>
          </div>

          {/* Right: resolve button */}
          <button
            type="button"
            onClick={() => onResolveContact(group.contactId)}
            className="shrink-0 rounded px-3 py-1.5 text-sm font-medium transition-colors bg-sky-600 text-white hover:bg-sky-500"
          >
            Resolve →
          </button>
        </div>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className={`flex items-center justify-between pt-2 text-sm ${TC.textMuted}`}>
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="disabled:opacity-40 hover:opacity-80 transition-opacity px-2 py-1"
          >
            ← Previous
          </button>

          <span>
            Page {safePage + 1} of {totalPages}
          </span>

          <button
            type="button"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="disabled:opacity-40 hover:opacity-80 transition-opacity px-2 py-1"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
