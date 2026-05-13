/**
 * @file GoogleContactsTab.tsx
 * Settings tab: Google Contacts read-only sync (Phase 1).
 *
 * RO-INVARIANT L5.1: no Push/Save/Upload/Send/Submit buttons exist in this tab.
 * RO-INVARIANT INV-2 / INV-6: every Sync now goes through DryRunModal; user
 * must explicitly Apply before any DB mutation lands.
 * RO-INVARIANT INV-5: conflicts are queued, never auto-resolved.
 *
 * Setup section: user pastes their Google OAuth Client ID into an input field.
 * It is persisted in the meta table via runtime.clientIdStore (no .env, no rebuild).
 * The Setup section is visible only when NOT connected.
 *
 * EDITING RULES:
 *  - Never add write-direction buttons (Push, Save, Upload, Send, Submit).
 *  - All functional UI must be gated behind a connected runtime — when
 *    `runtime` is null (web shell or before init), render the desktop-only
 *    notice instead.
 *  - Disconnect goes through the 3-option confirmation flow (Keep / Delete
 *    / Cancel) with a second confirmation for "Delete them all".
 *  - No `any` types.
 *  - All comments must remain in English.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Contact, GoogleSyncRuntime, Changeset, ConflictRow } from '@smart-contacts/shared'
import { useApp } from '../AppContext'
import { DryRunModal } from '../sync/DryRunModal'
import { PendingConflictsList } from '../sync/PendingConflictsList'
import { ConflictResolutionModal } from '../sync/ConflictResolutionModal'

// ---------------------------------------------------------------------------
// Tauri detection — Phase 1 gate
// ---------------------------------------------------------------------------

// Tauri v2 exposes `__TAURI_INTERNALS__`; older v1 used `__TAURI__`.
// Accept either to be robust across Tauri version upgrades.
const isTauri: boolean =
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoogleContactsTabProps {
  /** Wired Google sync runtime from the Tauri host. Null when web shell or before db init. */
  runtime: GoogleSyncRuntime | null
  /** Current contacts list — used to look up display names for the conflict list. */
  contacts: Contact[]
  /** Notify parent to reload contacts (after Disconnect-Delete or successful Sync). */
  refreshContacts: () => void
  /** Toast hook for surface-level notifications. */
  onToast?: (message: string) => void
}

type DisconnectStep = 'idle' | 'choose_action' | 'confirm_delete'

interface PendingState {
  changeset: Changeset
  /** Resolves with whether user clicked Apply (true) or Cancel (false). */
  decide: (apply: boolean) => void
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GoogleContactsTab({
  runtime,
  contacts,
  refreshContacts,
  onToast,
}: GoogleContactsTabProps) {
  const { TC, t } = useApp()

  // ---- Connection state ----
  const [isConnected, setIsConnected] = useState(false)
  const [pendingConflictCount, setPendingConflictCount] = useState(0)
  const [lastSync, setLastSync] = useState<{ ts: string; appliedCount: number } | null>(null)

  // ---- Setup section state (client_id input) ----
  const [clientIdInput, setClientIdInput] = useState('')
  const [savingClientId, setSavingClientId] = useState(false)
  const [hasClientId, setHasClientId] = useState(false)

  // ---- Action loading flags ----
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [syncNowLoading, setSyncNowLoading] = useState(false)
  const [disconnectStep, setDisconnectStep] = useState<DisconnectStep>('idle')

  // ---- Modal state ----
  const [pending, setPending] = useState<PendingState | null>(null)
  const [conflictsListOpen, setConflictsListOpen] = useState(false)
  const [resolveContactId, setResolveContactId] = useState<string | null>(null)
  const [resolveContactConflicts, setResolveContactConflicts] = useState<ConflictRow[]>([])

  // ---- Contact-name lookup (derived from contacts prop) ----
  const contactNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of contacts) {
      const name =
        c.displayName?.trim() ||
        [c.givenName, c.familyName].filter(Boolean).join(' ').trim() ||
        c.id
      map.set(c.id, name)
    }
    return map
  }, [contacts])

  // ---- Refresh helpers ----
  const refreshStatus = useCallback(async () => {
    if (!runtime) return
    const [connected, pendingCount, info] = await Promise.all([
      runtime.isConnected(),
      runtime.getPendingConflictCount(),
      runtime.getLastSyncInfo(),
    ])
    setIsConnected(connected)
    setPendingConflictCount(pendingCount)
    setLastSync(info)
  }, [runtime])

  // ---- Load client_id on mount / runtime change ----
  useEffect(() => {
    if (!runtime) return
    void runtime.clientIdStore.get().then((val) => {
      if (val !== null) {
        setClientIdInput(val)
        setHasClientId(true)
      }
    })
  }, [runtime])

  // ---- Lifecycle: initial load + on runtime change ----
  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // ---- Handlers ----

  const handleSaveClientId = useCallback(async () => {
    if (!runtime) return
    const value = clientIdInput.trim()
    if (!value) return
    setSavingClientId(true)
    try {
      await runtime.clientIdStore.set(value)
      setHasClientId(true)
      onToast?.('Client ID saved')
    } finally {
      setSavingClientId(false)
    }
  }, [runtime, clientIdInput, onToast])

  const handleConnect = useCallback(async () => {
    if (!runtime) return
    setConnecting(true)
    try {
      await runtime.connect()
      onToast?.(t('googleContacts.connectedToast') || 'Connected to Google Contacts')
      await refreshStatus()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Surface the full error to DevTools console so the user can copy it
      // even after the toast auto-dismisses. Critical for diagnosing 400/403
      // errors from Google's token endpoint where the response body holds
      // the real cause (invalid_grant, redirect_uri_mismatch, etc.).
      // eslint-disable-next-line no-console
      console.error('[GoogleContacts] Connect failed:', e)
      if (msg.startsWith('NO_CLIENT_ID')) {
        onToast?.('Set Client ID first')
      } else {
        onToast?.((t('googleContacts.connectFailed') || 'Connect failed') + ': ' + msg)
      }
    } finally {
      setConnecting(false)
    }
  }, [runtime, onToast, t, refreshStatus])

  const handleSyncNow = useCallback(async () => {
    if (!runtime) return
    setSyncNowLoading(true)
    try {
      const result = await runtime.pullEngine.run({
        confirmFn: (changeset: Changeset) =>
          new Promise<boolean>((resolve) => {
            setPending({
              changeset,
              decide: (apply) => {
                setPending(null)
                resolve(apply)
              },
            })
          }),
      })
      // After apply: refresh counters + parent contact list + notify open contact-detail panels
      await refreshStatus()
      refreshContacts()
      window.dispatchEvent(new Event('google-contacts-sync-changed'))
      if (result.kind === 'applied') {
        onToast?.(
          (t('googleContacts.applied') || 'Sync applied') +
            `: ${result.appliedCount} change${result.appliedCount === 1 ? '' : 's'}` +
            (result.conflictCount > 0 ? `, ${result.conflictCount} conflict(s) queued` : ''),
        )
      } else if (result.kind === 'cancelled') {
        onToast?.(t('googleContacts.cancelled') || 'Sync cancelled')
      } else if (result.kind === 'up_to_date') {
        onToast?.(t('googleContacts.upToDate') || 'Already up to date')
      } else if (result.kind === 'failed') {
        onToast?.((t('googleContacts.syncFailed') || 'Sync failed') + ': ' + result.error.message)
      }
    } finally {
      setSyncNowLoading(false)
    }
  }, [runtime, onToast, t, refreshStatus, refreshContacts])

  const handleOpenInGoogle = useCallback(() => {
    // Phase 1: plain external link via window.open.
    window.open('https://contacts.google.com/', '_blank')
  }, [])

  const handleDisconnectClick = useCallback(() => setDisconnectStep('choose_action'), [])
  const handleCancelDisconnect = useCallback(() => setDisconnectStep('idle'), [])

  const handleKeepAndDisconnect = useCallback(async () => {
    if (!runtime) return
    setDisconnecting(true)
    try {
      await runtime.disconnect({ deleteImported: false })
      onToast?.(
        t('googleContacts.disconnectedKeep') || 'Disconnected. Imported contacts kept locally.',
      )
      await refreshStatus()
      // Refresh parent contact list so G-badges + Labels sections re-evaluate.
      refreshContacts()
      // Notify any open ContactDetail / GoogleLabelsSection to refetch label memberships.
      window.dispatchEvent(new Event('google-contacts-sync-changed'))
    } finally {
      setDisconnecting(false)
      setDisconnectStep('idle')
    }
  }, [runtime, onToast, t, refreshStatus, refreshContacts])

  const handleDeleteConfirm = useCallback(async () => {
    if (!runtime) return
    setDisconnecting(true)
    try {
      await runtime.disconnect({ deleteImported: true })
      onToast?.(
        t('googleContacts.disconnectedDelete') || 'Disconnected. Imported contacts deleted.',
      )
      await refreshStatus()
      refreshContacts()
    } finally {
      setDisconnecting(false)
      setDisconnectStep('idle')
    }
  }, [runtime, onToast, t, refreshStatus, refreshContacts])

  const handleReviewConflicts = useCallback(() => {
    setConflictsListOpen(true)
  }, [])

  const handleResolveContact = useCallback(
    async (contactId: string) => {
      if (!runtime) return
      const rows = await runtime.repos.conflict.listPending({ contactId })
      setResolveContactConflicts(rows)
      setResolveContactId(contactId)
    },
    [runtime],
  )

  const handleResolveOne = useCallback(
    async (
      id: number,
      resolution: 'local' | 'google' | 'custom',
      customValueJson?: string,
    ): Promise<void> => {
      if (!runtime) return
      // Use runtime.resolveConflict — applies real side-effects atomically (spec §6.7).
      await runtime.resolveConflict(id, resolution, customValueJson ?? null)
      // Refresh contacts in case resolution mutated the contacts row.
      refreshContacts()
      // Notify any open ContactDetail / GoogleLabelsSection to refetch.
      window.dispatchEvent(new Event('google-contacts-sync-changed'))
      // Refresh the modal's open conflicts list and counters.
      if (resolveContactId !== null) {
        const rows = await runtime.repos.conflict.listPending({ contactId: resolveContactId })
        setResolveContactConflicts(rows)
        if (rows.length === 0) setResolveContactId(null)
      }
      await refreshStatus()
    },
    [runtime, resolveContactId, refreshStatus, refreshContacts],
  )

  // ---- Format helpers ----

  const formatSyncAt = (iso: string | null): string => {
    if (!iso) return t('sync.never') || 'Never'
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  // ---- Shared CSS ----
  const rowCls = `flex items-center justify-between py-2.5 border-b ${TC.borderClass}`
  const labelCls = `text-sm ${TC.textMuted}`
  const valueCls = `text-sm ${TC.textSec}`

  // ---------------------------------------------------------------------------
  // Non-Tauri shell OR runtime not yet ready: render desktop-only notice
  // ---------------------------------------------------------------------------

  if (!isTauri || !runtime) {
    return (
      <div className="space-y-3">
        <div
          className={`rounded-md border ${TC.borderClass} px-4 py-3 text-sm ${TC.textMuted} bg-amber-500/10`}
        >
          {t('googleContacts.desktopOnly') ||
            'Google Contacts sync is available in the desktop (Tauri) build only.'}
        </div>
        <p className={`text-xs ${TC.textMuted}`}>
          {t('googleContacts.phaseOneNotice') ||
            'Two-way sync (push to Google) is coming in a future version. This release only reads from Google.'}
        </p>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Tauri shell: full tab UI
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-1">
      {/* --- Setup section (visible only when NOT connected) --- */}
      {!isConnected && (
        <div className={`mb-4 p-3 rounded border ${TC.borderClass} ${TC.elevated}`}>
          <div className={`text-sm font-medium ${TC.text} mb-2`}>Setup</div>
          <label className={`block text-xs ${TC.textMuted} mb-1`}>Google OAuth Client ID</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={clientIdInput}
              onChange={(e) => setClientIdInput(e.target.value)}
              placeholder="xxx-yyy.apps.googleusercontent.com"
              className={`flex-1 px-2 py-1 text-sm rounded border ${TC.borderClass} bg-transparent ${TC.text}`}
            />
            <button
              type="button"
              disabled={savingClientId || clientIdInput.trim() === ''}
              onClick={() => void handleSaveClientId()}
              className="px-3 py-1.5 rounded text-sm bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {savingClientId ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className={`text-xs ${TC.textMuted} mt-2`}>
            Get one from console.cloud.google.com → OAuth client ID → Desktop App type.
          </p>
        </div>
      )}

      {/* --- Status row --- */}
      <div className={rowCls}>
        <span className={labelCls}>{t('googleContacts.status') || 'Status'}</span>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-300">
              {t('googleContacts.connected') || 'Connected'}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-300">
              {t('googleContacts.notConnected') || 'Not connected'}
            </span>
          )}
        </div>
      </div>

      {/* --- Last sync row (if connected) --- */}
      {isConnected && (
        <div className={rowCls}>
          <span className={labelCls}>{t('sync.last') || 'Last sync'}</span>
          <span className={valueCls}>
            {formatSyncAt(lastSync?.ts ?? null)}
            {lastSync && lastSync.appliedCount > 0 && (
              <span className={`ml-2 text-xs ${TC.textMuted}`}>
                ({lastSync.appliedCount} {t('googleContacts.contacts') || 'contacts'})
              </span>
            )}
          </span>
        </div>
      )}

      {/* --- Pending conflicts row (if connected and count > 0) --- */}
      {isConnected && pendingConflictCount > 0 && (
        <div className={rowCls}>
          <span className={labelCls}>{t('googleContacts.conflicts') || 'Conflicts'}</span>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-xs bg-orange-500/20 text-orange-300">
              ⚠ {pendingConflictCount} {t('googleContacts.pendingConflicts') || 'pending conflicts'}
            </span>
            <button
              type="button"
              className="text-xs text-sky-400 hover:underline"
              onClick={handleReviewConflicts}
            >
              {t('googleContacts.review') || 'Review'} →
            </button>
          </div>
        </div>
      )}

      {/* --- Phase 1 notice --- */}
      <div className={rowCls}>
        <p className={`text-xs ${TC.textMuted} py-1`}>
          {t('googleContacts.phaseOneNotice') ||
            'Two-way sync (push to Google) is coming in a future version. This release only reads from Google.'}
        </p>
      </div>

      {/* --- Action buttons row --- */}
      <div className="flex items-center justify-end gap-2 pt-2.5">
        {isConnected ? (
          <>
            <button
              type="button"
              disabled={syncNowLoading}
              onClick={() => void handleSyncNow()}
              className={`px-3 py-1.5 rounded text-sm border ${TC.borderClass} ${TC.textSec} hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {syncNowLoading
                ? t('googleContacts.syncing') || 'Syncing…'
                : t('sync.now') || 'Sync now'}
            </button>

            <button
              type="button"
              className={`px-3 py-1.5 rounded text-sm border ${TC.borderClass} ${TC.textSec} hover:opacity-80`}
              onClick={handleOpenInGoogle}
            >
              {t('googleContacts.openInGoogle') || 'Open in Google'}
            </button>

            <button
              type="button"
              disabled={disconnecting}
              onClick={handleDisconnectClick}
              className="px-3 py-1.5 rounded text-sm border border-red-500/40 text-red-400 hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('googleContacts.disconnect') || 'Disconnect'}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!hasClientId || connecting}
            className="px-3 py-1.5 rounded text-sm bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => void handleConnect()}
          >
            {connecting
              ? t('googleContacts.connecting') || 'Connecting…'
              : t('googleContacts.connect') || 'Connect Google'}
          </button>
        )}
      </div>

      {/* Disconnect confirmation — step 1 */}
      {disconnectStep === 'choose_action' && (
        <div className={`mt-4 rounded-lg border ${TC.borderClass} ${TC.surface} p-4 space-y-3`}>
          <p className={`text-sm font-medium ${TC.text}`}>
            {t('googleContacts.disconnectTitle') || 'What to do with imported contacts?'}
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={disconnecting}
              onClick={() => void handleKeepAndDisconnect()}
              className={`w-full text-left px-3 py-2 rounded text-sm border ${TC.borderClass} ${TC.textSec} hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {t('googleContacts.keepLocal') || 'Keep them as local'}
            </button>
            <button
              type="button"
              onClick={() => setDisconnectStep('confirm_delete')}
              className="w-full text-left px-3 py-2 rounded text-sm border border-red-500/40 text-red-400 hover:opacity-80"
            >
              {t('googleContacts.deleteAll') || 'Delete them all'}
            </button>
            <button
              type="button"
              onClick={handleCancelDisconnect}
              className={`w-full text-left px-3 py-2 rounded text-sm border ${TC.borderClass} ${TC.textMuted} hover:opacity-80`}
            >
              {t('common.cancel') || 'Cancel'}
            </button>
          </div>
          <p className={`text-xs ${TC.textMuted}`}>
            {t('googleContacts.revokeHint') ||
              'To revoke at Google: myaccount.google.com → Security → Third-party access'}
          </p>
        </div>
      )}

      {/* Disconnect confirmation — step 2 */}
      {disconnectStep === 'confirm_delete' && (
        <div className={`mt-4 rounded-lg border border-red-500/40 ${TC.surface} p-4 space-y-3`}>
          <p className={`text-sm font-medium text-red-400`}>
            {t('googleContacts.confirmDeleteTitle') ||
              'Are you sure? This will permanently delete all imported contacts.'}
          </p>
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={handleCancelDisconnect}
              className={`px-3 py-1.5 rounded text-sm border ${TC.borderClass} ${TC.textMuted} hover:opacity-80`}
            >
              {t('common.cancel') || 'Cancel'}
            </button>
            <button
              type="button"
              disabled={disconnecting}
              onClick={() => void handleDeleteConfirm()}
              className="px-3 py-1.5 rounded text-sm bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {disconnecting
                ? t('googleContacts.deleting') || 'Deleting…'
                : t('googleContacts.confirmDelete') || 'Yes, delete them all'}
            </button>
          </div>
        </div>
      )}

      {/* --- DryRunModal (rendered when pull-engine asks for confirmation) --- */}
      <DryRunModal
        open={pending !== null}
        changeset={pending?.changeset ?? null}
        onApply={() => pending?.decide(true)}
        onCancel={() => pending?.decide(false)}
      />

      {/* --- PendingConflictsList opened inline (full-screen overlay) --- */}
      {conflictsListOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConflictsListOpen(false)
          }}
        >
          <div
            className={`${TC.surface} ${TC.text} w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-lg border ${TC.borderClass} p-4 shadow-2xl`}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className={`text-base font-semibold ${TC.text}`}>
                {t('googleContacts.conflictsTitle') || 'Pending sync conflicts'}
              </h2>
              <button
                type="button"
                onClick={() => setConflictsListOpen(false)}
                className={`text-xs ${TC.textMuted} hover:underline`}
              >
                {t('common.close') || 'Close'}
              </button>
            </div>
            <PendingConflictsList
              conflictRepo={runtime.repos.conflict}
              contactNameById={contactNameById}
              onResolveContact={(id) => void handleResolveContact(id)}
            />
          </div>
        </div>
      )}

      {/* --- ConflictResolutionModal --- */}
      {resolveContactId !== null && (
        <ConflictResolutionModal
          open={true}
          contactId={resolveContactId}
          contactName={contactNameById.get(resolveContactId) ?? resolveContactId}
          conflicts={resolveContactConflicts}
          onResolveOne={handleResolveOne}
          onClose={() => setResolveContactId(null)}
        />
      )}
    </div>
  )
}
