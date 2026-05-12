/**
 * @file ConflictResolutionModal.tsx
 * Per-contact conflict resolution modal — shows one ConflictRow at a time and
 * lets the user choose Keep mine / Use Google's / Edit (custom) for each
 * field-level conflict detected during 3-way merge.
 *
 * RO-INVARIANT INV-5 (conflict queue with on-demand resolution):
 *   This component only calls onResolveOne, never writes to the DB directly.
 *   Resolution effects (§6.7):
 *     'local'  — keep localValueJson; Google value discarded for this field.
 *     'google' — apply googleValueJson; local value overwritten on next sync.
 *     'custom' — use the textarea value; written as customValueJson.
 *   Deletion conflict ('__deletion__') surfaces its own two-button layout (§8.5).
 *   Photo conflict ('photos[0]') shows image placeholders (§8.4).
 *   Bulk-within-contact shortcuts apply the chosen resolution to ALL pending
 *   conflicts for the current contact — NO global/cross-contact bulk action.
 *
 * Rules:
 *   - No DB access — all mutations via onResolveOne callback.
 *   - Esc closes without resolving.
 *   - No `any` types.
 *   - Use useApp() TC for all styling.
 */

import { useState, useCallback, useEffect, type KeyboardEvent } from 'react'
import type { ConflictRow } from '@smart-contacts/shared'
import { useApp } from '../AppContext'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConflictResolutionModalProps {
  open: boolean
  contactId: string
  contactName: string
  /** Pending conflicts for this contact (status='pending'). */
  conflicts: ConflictRow[]
  onResolveOne: (
    id: number,
    resolution: 'local' | 'google' | 'custom',
    customValueJson?: string,
  ) => Promise<void>
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Field-path humaniser
// ---------------------------------------------------------------------------

/**
 * Converts internal field_path notation to a readable label.
 * Examples: "phones[+15551234567]" → "Phone +1 555 123 4567"
 *           "emails[0]"            → "Email [0]"
 *           "names[0].givenName"   → "Name: givenName"
 *           "__deletion__"         → "(contact deletion)"
 */
function humanizeFieldPath(fieldPath: string): string {
  if (fieldPath === '__deletion__') return '(contact deletion)'
  if (fieldPath === 'photos[0]') return 'Profile photo'

  // Strip leading field name
  const bracketIdx = fieldPath.indexOf('[')
  if (bracketIdx === -1) {
    // Simple top-level key
    return fieldPath.charAt(0).toUpperCase() + fieldPath.slice(1)
  }

  const field = fieldPath.slice(0, bracketIdx)
  const rest = fieldPath.slice(bracketIdx)

  // Map common plurals → singular label
  const labelMap: Record<string, string> = {
    phones: 'Phone',
    emails: 'Email',
    urls: 'URL',
    addresses: 'Address',
    organizations: 'Organization',
    events: 'Event',
    imClients: 'IM',
    relationsExternal: 'Relation',
    relationsInternal: 'Relation',
    reminders: 'Reminder',
    tags: 'Tag',
    groups: 'Group',
    customFields: 'Custom field',
    names: 'Name',
    photos: 'Photo',
  }
  const label = labelMap[field] ?? field.charAt(0).toUpperCase() + field.slice(1)

  // Extract index/key from brackets
  const match = rest.match(/^\[([^\]]+)\](.*)$/)
  if (!match) return `${label} ${rest}`
  const key = match[1]
  const tail = match[2] // e.g. ".givenName"

  const suffix = tail ? `: ${tail.replace(/^\./, '')}` : ` ${key}`
  return `${label}${suffix}`
}

// ---------------------------------------------------------------------------
// Value renderer
// ---------------------------------------------------------------------------

function renderValue(json: string | null): string {
  if (json === null) return '(not previously synced)'
  try {
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed === 'string') return parsed
    if (typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return json
  }
}

// ---------------------------------------------------------------------------
// ValueBox — coloured box showing a single version of a value
// ---------------------------------------------------------------------------

function ValueBox({
  label,
  value,
  accent,
}: {
  label: string
  value: string | null
  accent: string
}) {
  const { TC } = useApp()
  return (
    <div className={`flex-1 rounded border ${TC.borderClass} ${TC.elevated} p-2`}>
      <p className={`text-xs font-semibold mb-1 ${accent}`}>{label}</p>
      <pre
        className={`text-xs whitespace-pre-wrap break-all ${TC.textSec}`}
        style={{ fontFamily: 'inherit' }}
      >
        {renderValue(value)}
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TextConflictRow — one field-level text/scalar conflict
// ---------------------------------------------------------------------------

function TextConflictRow({
  conflict,
  onResolve,
}: {
  conflict: ConflictRow
  onResolve: (resolution: 'local' | 'google' | 'custom', custom?: string) => Promise<void>
}) {
  const { TC } = useApp()
  const [editing, setEditing] = useState(false)
  const [customText, setCustomText] = useState<string>(() => renderValue(conflict.localValueJson))
  const [busy, setBusy] = useState(false)

  const resolve = useCallback(
    async (resolution: 'local' | 'google' | 'custom', custom?: string) => {
      setBusy(true)
      try {
        await onResolve(resolution, custom)
      } finally {
        setBusy(false)
        setEditing(false)
      }
    },
    [onResolve],
  )

  const btnBase = `px-3 py-1 rounded text-xs font-medium disabled:opacity-50 transition-colors`

  return (
    <div className={`rounded-lg border ${TC.borderClass} p-3 space-y-2`}>
      <p className={`text-xs font-semibold ${TC.text}`}>{humanizeFieldPath(conflict.fieldPath)}</p>

      {/* Three-way value comparison */}
      <div className="flex gap-2 flex-wrap">
        <ValueBox label="Your version" value={conflict.localValueJson} accent="text-sky-400" />
        <ValueBox
          label="Google's version"
          value={conflict.googleValueJson}
          accent="text-emerald-400"
        />
        <ValueBox
          label="Last synced version"
          value={conflict.baseValueJson}
          accent={TC.textMuted}
        />
      </div>

      {/* Resolution buttons */}
      {!editing && (
        <div className="flex flex-wrap gap-2 mt-1">
          <button
            className={`${btnBase} bg-sky-600 hover:bg-sky-500 text-white`}
            disabled={busy}
            onClick={() => resolve('local')}
          >
            Keep mine
          </button>
          <button
            className={`${btnBase} bg-emerald-600 hover:bg-emerald-500 text-white`}
            disabled={busy}
            onClick={() => resolve('google')}
          >
            Use Google&apos;s
          </button>
          <button
            className={`${btnBase} ${TC.elevated} ${TC.text} hover:opacity-80`}
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        </div>
      )}

      {/* Custom edit textarea */}
      {editing && (
        <div className="space-y-2">
          <textarea
            className={`w-full text-xs rounded border p-2 outline-none focus:ring-1 focus:ring-sky-500 resize-y ${TC.input} ${TC.inputText}`}
            rows={4}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className={`${btnBase} bg-sky-600 hover:bg-sky-500 text-white`}
              disabled={busy}
              onClick={() => resolve('custom', JSON.stringify(customText))}
            >
              Save custom
            </button>
            <button
              className={`${btnBase} ${TC.elevated} ${TC.text} hover:opacity-80`}
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PhotoConflictRow — photo conflict (§8.4)
// ---------------------------------------------------------------------------

function PhotoConflictRow({
  conflict,
  onResolve,
}: {
  conflict: ConflictRow
  onResolve: (resolution: 'local' | 'google') => Promise<void>
}) {
  const { TC } = useApp()
  const [busy, setBusy] = useState(false)

  // Attempt to extract photo URLs from JSON values; fall back to placeholders
  let localSrc: string | null = null
  let googleSrc: string | null = null
  try {
    const lv: unknown = JSON.parse(conflict.localValueJson)
    if (typeof lv === 'string') localSrc = lv
    else if (lv && typeof lv === 'object' && 'url' in lv)
      localSrc = String((lv as Record<string, unknown>).url)
  } catch {
    /* use placeholder */
  }
  try {
    const gv: unknown = JSON.parse(conflict.googleValueJson ?? 'null')
    if (typeof gv === 'string') googleSrc = gv
    else if (gv && typeof gv === 'object' && 'url' in gv)
      googleSrc = String((gv as Record<string, unknown>).url)
  } catch {
    /* use placeholder */
  }

  const resolve = useCallback(
    async (resolution: 'local' | 'google') => {
      setBusy(true)
      try {
        await onResolve(resolution)
      } finally {
        setBusy(false)
      }
    },
    [onResolve],
  )

  const btnBase = `px-3 py-1 rounded text-xs font-medium disabled:opacity-50 transition-colors`

  return (
    <div className={`rounded-lg border ${TC.borderClass} p-3 space-y-2`}>
      <p className={`text-xs font-semibold ${TC.text}`}>Profile photo</p>
      <div className="flex gap-4">
        {/* Local photo */}
        <div className="flex-1 text-center space-y-1">
          <p className={`text-xs ${TC.textMuted}`}>Your photo</p>
          {localSrc ? (
            <img
              src={localSrc}
              alt="Local photo"
              className="w-20 h-20 rounded-full object-cover mx-auto border border-sky-400"
            />
          ) : (
            <div
              className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center border border-sky-400 ${TC.elevated}`}
            >
              <span className={`text-xs ${TC.textMuted}`}>Local photo</span>
            </div>
          )}
        </div>
        {/* Google photo */}
        <div className="flex-1 text-center space-y-1">
          <p className={`text-xs ${TC.textMuted}`}>Google&apos;s photo</p>
          {googleSrc ? (
            <img
              src={googleSrc}
              alt="Google photo"
              className="w-20 h-20 rounded-full object-cover mx-auto border border-emerald-400"
            />
          ) : (
            <div
              className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center border border-emerald-400 ${TC.elevated}`}
            >
              <span className={`text-xs ${TC.textMuted}`}>Google photo</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          className={`${btnBase} bg-sky-600 hover:bg-sky-500 text-white`}
          disabled={busy}
          onClick={() => resolve('local')}
        >
          Keep mine
        </button>
        <button
          className={`${btnBase} bg-emerald-600 hover:bg-emerald-500 text-white`}
          disabled={busy}
          onClick={() => resolve('google')}
        >
          Use Google&apos;s
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DeletionConflictRow — deletion conflict (§8.5)
// ---------------------------------------------------------------------------

function DeletionConflictRow({
  conflict,
  onResolve,
}: {
  conflict: ConflictRow
  onResolve: (resolution: 'local' | 'google') => Promise<void>
}) {
  const { TC } = useApp()
  const [busy, setBusy] = useState(false)

  const resolve = useCallback(
    async (resolution: 'local' | 'google') => {
      setBusy(true)
      try {
        await onResolve(resolution)
      } finally {
        setBusy(false)
      }
    },
    [onResolve],
  )

  const btnBase = `px-3 py-1 rounded text-xs font-medium disabled:opacity-50 transition-colors`

  return (
    <div className={`rounded-lg border border-amber-500/60 p-3 space-y-2`}>
      <p className={`text-xs font-semibold text-amber-400`}>Contact deletion conflict</p>
      <p className={`text-sm ${TC.textSec}`}>
        This contact was removed from your Google Contacts. But you have local changes.
      </p>
      <p className={`text-xs ${TC.textMuted}`}>
        Detected: {new Date(conflict.detectedAt).toLocaleString()}
      </p>
      <div className="flex gap-2 mt-1">
        <button
          className={`${btnBase} bg-sky-600 hover:bg-sky-500 text-white`}
          disabled={busy}
          onClick={() => resolve('local')}
        >
          Keep as local contact
        </button>
        <button
          className={`${btnBase} bg-red-600 hover:bg-red-500 text-white`}
          disabled={busy}
          onClick={() => resolve('google')}
        >
          Delete it
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConflictResolutionModal
// ---------------------------------------------------------------------------

export function ConflictResolutionModal({
  open,
  contactName,
  conflicts,
  onResolveOne,
  onClose,
}: ConflictResolutionModalProps) {
  const { TC } = useApp()
  const [bulkBusy, setBulkBusy] = useState(false)

  // Esc → close
  useEffect(() => {
    if (!open) return
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handlePanelKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    },
    [onClose],
  )

  /** Resolve all pending conflicts in this contact with the same resolution. */
  const resolveAll = useCallback(
    async (resolution: 'local' | 'google') => {
      setBulkBusy(true)
      try {
        for (const c of conflicts) {
          await onResolveOne(c.id, resolution)
        }
        onClose()
      } finally {
        setBulkBusy(false)
      }
    },
    [conflicts, onResolveOne, onClose],
  )

  if (!open) return null

  const btnBase = `px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50 transition-colors`

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`${TC.surface} ${TC.text} w-full max-w-2xl max-h-[90vh] flex flex-col rounded-lg shadow-2xl border ${TC.borderClass}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handlePanelKeyDown}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-3 border-b ${TC.borderClass}`}>
          <div>
            <h2 className={`text-base font-semibold ${TC.text}`}>Resolve conflicts</h2>
            <p className={`text-xs ${TC.textMuted}`}>{contactName}</p>
          </div>
          <button
            className={`p-1 rounded hover:opacity-70 ${TC.textMuted}`}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Conflict list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {conflicts.length === 0 && (
            <p className={`text-sm ${TC.textMuted}`}>No pending conflicts for this contact.</p>
          )}
          {conflicts.map((c) => {
            if (c.fieldPath === '__deletion__') {
              return (
                <DeletionConflictRow
                  key={c.id}
                  conflict={c}
                  onResolve={(resolution) => onResolveOne(c.id, resolution)}
                />
              )
            }
            if (c.fieldPath === 'photos[0]') {
              return (
                <PhotoConflictRow
                  key={c.id}
                  conflict={c}
                  onResolve={(resolution) => onResolveOne(c.id, resolution)}
                />
              )
            }
            return (
              <TextConflictRow
                key={c.id}
                conflict={c}
                onResolve={(resolution, custom) => onResolveOne(c.id, resolution, custom)}
              />
            )
          })}
        </div>

        {/* Bulk-within-contact footer */}
        {conflicts.length > 1 && (
          <div className={`px-5 py-3 border-t ${TC.borderClass} flex flex-wrap items-center gap-3`}>
            <span className={`text-xs ${TC.textMuted} flex-1`}>
              Resolve all {conflicts.length} conflicts for this contact:
            </span>
            <button
              className={`${btnBase} bg-sky-600 hover:bg-sky-500 text-white`}
              disabled={bulkBusy}
              onClick={() => resolveAll('local')}
            >
              Keep all mine
            </button>
            <button
              className={`${btnBase} bg-emerald-600 hover:bg-emerald-500 text-white`}
              disabled={bulkBusy}
              onClick={() => resolveAll('google')}
            >
              Use all Google&apos;s
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
