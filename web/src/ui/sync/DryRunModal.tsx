/**
 * @file DryRunModal.tsx
 * Modal that presents a Changeset (dry-run output from the differ) to the user
 * for review before any DB mutation is applied.
 *
 * RO-INVARIANT INV-2: no data is written to the DB until the user explicitly
 * clicks "Apply N changes" — every apply MUST go through this modal.
 * RO-INVARIANT INV-6: conflicts are NEVER included in the apply batch; they are
 * always queued separately for manual resolution.
 *
 * Rules:
 *  - Render null when open===false or changeset===null.
 *  - Cancel never triggers onApply.
 *  - Apply button shows loading state while onApply Promise is pending.
 *  - Conflict count is shown but the conflicts are NOT applied — they are queued.
 *  - No `any` types.
 */
import { useState, useCallback, type KeyboardEvent } from 'react'
import type { Changeset } from '@smart-contacts/shared'
import { useApp } from '../AppContext'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DryRunModalProps {
  open: boolean
  changeset: Changeset | null
  onApply: () => void | Promise<void>
  onCancel: () => void
}

// ---------------------------------------------------------------------------
// Helper: display name from a NormalizedContact-like object
// ---------------------------------------------------------------------------

function label(obj: { displayName?: string; googleResourceName: string }): string {
  return obj.displayName?.trim() || obj.googleResourceName
}

// ---------------------------------------------------------------------------
// Sub-component: collapsible details section
// ---------------------------------------------------------------------------

function DetailsSection({
  changeset,
  TC,
}: {
  changeset: Changeset
  TC: ReturnType<typeof useApp>['TC']
}) {
  const [expanded, setExpanded] = useState(false)

  const { cleanInserts, cleanUpdates, cleanDeletes, conflicts } = changeset

  // Deduplicate updates by googleResourceName for display (multiple field patches per contact)
  const updatedRns = Array.from(new Set(cleanUpdates.map((u) => u.googleResourceName)))

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`text-xs font-medium ${TC.textMuted} hover:${TC.textSec} transition-colors flex items-center gap-1`}
      >
        <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>
          ▶
        </span>
        {expanded ? 'Hide details' : 'Show details'}
      </button>

      {expanded && (
        <div
          className={`mt-2 rounded border ${TC.borderClass} ${TC.elevated} text-xs divide-y divide-current/10 max-h-56 overflow-y-auto`}
        >
          {/* Inserts */}
          {cleanInserts.length > 0 && (
            <div className="px-3 py-2 space-y-0.5">
              <p className={`font-semibold text-emerald-500 mb-1`}>Added ({cleanInserts.length})</p>
              {cleanInserts.map((c) => (
                <p key={c.googleResourceName} className={TC.text}>
                  {label(c)}
                </p>
              ))}
            </div>
          )}

          {/* Updates */}
          {updatedRns.length > 0 && (
            <div className="px-3 py-2 space-y-0.5">
              <p className={`font-semibold text-sky-400 mb-1`}>Updated ({updatedRns.length})</p>
              {updatedRns.map((rn) => {
                const fields = cleanUpdates
                  .filter((u) => u.googleResourceName === rn)
                  .map((u) => u.fieldPath)
                return (
                  <p key={rn} className={TC.text}>
                    {rn}
                    <span className={`ml-1 ${TC.textMuted}`}>({fields.join(', ')})</span>
                  </p>
                )
              })}
            </div>
          )}

          {/* Deletes */}
          {cleanDeletes.length > 0 && (
            <div className="px-3 py-2 space-y-0.5">
              <p className={`font-semibold text-red-400 mb-1`}>
                Deleted in Google ({cleanDeletes.length})
              </p>
              {cleanDeletes.map((rn) => (
                <p key={rn} className={TC.text}>
                  {rn}
                </p>
              ))}
            </div>
          )}

          {/* Conflicts */}
          {conflicts.length > 0 && (
            <div className="px-3 py-2 space-y-0.5">
              <p className={`font-semibold text-amber-400 mb-1`}>
                Conflicts — queued for review ({conflicts.length})
              </p>
              {conflicts.map((c, i) => (
                <p key={i} className={TC.textMuted}>
                  {c.googleResourceName}: {c.fieldPath}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DryRunModal({ open, changeset, onApply, onCancel }: DryRunModalProps) {
  const { TC } = useApp()
  const [isApplying, setIsApplying] = useState(false)

  const handleApply = useCallback(async () => {
    setIsApplying(true)
    try {
      await onApply()
    } finally {
      setIsApplying(false)
    }
  }, [onApply])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (!isApplying) onCancel()
      }
    },
    [isApplying, onCancel],
  )

  // Guard: render nothing when closed or no changeset yet
  if (!open || !changeset) return null

  const { inserts, updates, deletes, conflicts } = changeset.counts
  const applyCount = inserts + updates + deletes
  const totalCount = applyCount + conflicts
  const isEmpty = totalCount === 0

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isApplying) onCancel()
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`${TC.surface} ${TC.text} w-full max-w-lg rounded-lg shadow-2xl border ${TC.borderClass} flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className={`flex items-center justify-between px-5 py-3 border-b ${TC.borderClass}`}>
          <h2 className={`text-base font-semibold ${TC.text}`}>
            Sync from Google — Review changes
          </h2>
        </div>

        {/* ── Body ── */}
        <div className="px-5 py-4">
          {isEmpty ? (
            <p className={`text-sm ${TC.textSec}`}>Up to date. No changes to apply.</p>
          ) : (
            <>
              {/* Summary rows */}
              <ul className="space-y-1.5 text-sm">
                {inserts > 0 && (
                  <li className="flex items-center gap-2">
                    <span className="font-bold text-emerald-500 w-5 text-center">+</span>
                    <span className={TC.text}>
                      <span className="font-semibold">{inserts}</span> contact
                      {inserts !== 1 ? 's' : ''} to add
                    </span>
                  </li>
                )}
                {updates > 0 && (
                  <li className="flex items-center gap-2">
                    <span className="font-bold text-sky-400 w-5 text-center">~</span>
                    <span className={TC.text}>
                      <span className="font-semibold">{updates}</span> contact
                      {updates !== 1 ? 's' : ''} to update
                    </span>
                  </li>
                )}
                {deletes > 0 && (
                  <li className="flex items-center gap-2">
                    <span className="font-bold text-red-400 w-5 text-center">–</span>
                    <span className={TC.text}>
                      <span className="font-semibold">{deletes}</span> contact
                      {deletes !== 1 ? 's' : ''} deleted in Google
                    </span>
                  </li>
                )}
                {conflicts > 0 && (
                  <li className="flex items-center gap-2">
                    <span className="font-bold text-amber-400 w-5 text-center">⚠</span>
                    <span className={TC.text}>
                      <span className="font-semibold">{conflicts}</span> conflict
                      {conflicts !== 1 ? 's' : ''} will be queued for review
                    </span>
                  </li>
                )}
              </ul>

              {/* Expandable details */}
              <DetailsSection changeset={changeset} TC={TC} />
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${TC.borderClass}`}>
          {isEmpty ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-1.5 rounded text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              OK
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onCancel}
                disabled={isApplying}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${TC.elevated} ${TC.textSec} hover:opacity-80 disabled:opacity-40`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={isApplying || applyCount === 0}
                className="px-4 py-1.5 rounded text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isApplying && (
                  <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                )}
                {isApplying
                  ? 'Applying…'
                  : `Apply ${applyCount} change${applyCount !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
