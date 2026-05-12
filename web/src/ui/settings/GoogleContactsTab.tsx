/**
 * @file GoogleContactsTab.tsx
 * Settings tab: Google Contacts read-only sync (Phase 1).
 *
 * RO-INVARIANT L5.1: no Push/Save/Upload/Send/Submit buttons exist in this tab.
 * This tab is strictly presentational — functional state is injected via props.
 *
 * EDITING RULES:
 *  - Never add write-direction buttons (Push, Save, Upload, Send, Submit).
 *  - All functional UI must be gated behind isTauri — in web-only shell, render
 *    the desktop-only notice instead.
 *  - disconnectFn is the only mutation entrypoint; it must go through the
 *    3-option confirmation flow (Keep / Delete / Cancel), with a second
 *    confirmation for "Delete them all".
 *  - No `any` types.
 *  - All comments must remain in English.
 */
import { useState } from 'react'
import { useApp } from '../AppContext'

// ---------------------------------------------------------------------------
// Local structural interfaces (avoid deep cross-package path imports)
// ---------------------------------------------------------------------------

/** Minimal pull-engine interface needed for Phase 1 props typing. */
export interface PullEngine {
  run(): Promise<unknown>
}

// ---------------------------------------------------------------------------
// Tauri detection — Phase 1 gate
// ---------------------------------------------------------------------------

const isTauri: boolean = typeof window !== 'undefined' && '__TAURI__' in window

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal token store interface — Phase 1 only needs the email for display. */
export interface TokenStore {
  /** Returns the stored account email, or null if not connected. */
  getEmail(): Promise<string | null>
}

export interface GoogleContactsTabProps {
  pullEngine?: PullEngine
  tokenStore?: TokenStore
  disconnectFn?: () => Promise<void>
  pendingConflictCount: number
  /** Whether OAuth tokens are present (i.e. user is connected). */
  isConnected: boolean
  /** Email of the connected account — null if not yet fetched or not connected. */
  accountEmail?: string | null
  /** ISO string of the last successful sync, or null. */
  lastSyncAt?: string | null
  /** Number of contacts applied in the last sync cycle. */
  lastSyncCount?: number
}

// ---------------------------------------------------------------------------
// Disconnect confirmation state machine
// ---------------------------------------------------------------------------

type DisconnectStep =
  | 'idle'
  | 'choose_action' // first modal: Keep / Delete / Cancel
  | 'confirm_delete' // second modal: are-you-sure for Delete

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GoogleContactsTab({
  disconnectFn,
  pendingConflictCount,
  isConnected,
  accountEmail,
  lastSyncAt,
  lastSyncCount,
}: GoogleContactsTabProps) {
  const { TC, t } = useApp()

  const [disconnectStep, setDisconnectStep] = useState<DisconnectStep>('idle')
  const [disconnecting, setDisconnecting] = useState(false)
  const [syncNowLoading, setSyncNowLoading] = useState(false)

  // ---- Shared CSS helpers (mirrors GoogleSyncTab pattern) ----
  const rowCls = `flex items-center justify-between py-2.5 border-b ${TC.borderClass}`
  const labelCls = `text-sm ${TC.textMuted}`
  const valueCls = `text-sm ${TC.textSec}`

  // ---- Handlers ----

  const handleSyncNow = async () => {
    // Phase 1: wired externally via pullEngine prop; here we just set loading state.
    setSyncNowLoading(true)
    try {
      // Actual invocation is responsibility of the parent wiring pullEngine.
      // Placeholder until parent wires the pull cycle.
      await Promise.resolve()
    } finally {
      setSyncNowLoading(false)
    }
  }

  const handleDisconnectClick = () => {
    setDisconnectStep('choose_action')
  }

  const handleKeepAndDisconnect = async () => {
    if (!disconnectFn) return
    setDisconnecting(true)
    try {
      await disconnectFn()
    } finally {
      setDisconnecting(false)
      setDisconnectStep('idle')
    }
  }

  const handleDeleteConfirm = async () => {
    // "Delete them all" path — still calls same disconnectFn; caller is responsible
    // for deleting imported contacts before/after token removal.
    if (!disconnectFn) return
    setDisconnecting(true)
    try {
      await disconnectFn()
    } finally {
      setDisconnecting(false)
      setDisconnectStep('idle')
    }
  }

  const handleCancelDisconnect = () => {
    setDisconnectStep('idle')
  }

  // ---- Format helpers ----

  const formatSyncAt = (iso: string | null | undefined): string => {
    if (!iso) return t('sync.never') || 'Never'
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  // ---------------------------------------------------------------------------
  // Non-Tauri shell: render desktop-only notice
  // ---------------------------------------------------------------------------

  if (!isTauri) {
    return (
      <div className="space-y-3">
        <div
          className={`rounded-md border ${TC.borderClass} px-4 py-3 text-sm ${TC.textMuted} bg-amber-500/10`}
        >
          {t('googleContacts.desktopOnly') ||
            'Google Contacts sync is available in the desktop (Tauri) build only.'}
        </div>

        {/* Phase 1 roadmap notice */}
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

      {/* --- Account row (if connected) --- */}
      {isConnected && (
        <div className={rowCls}>
          <span className={labelCls}>{t('googleContacts.account') || 'Account'}</span>
          <span className={valueCls}>
            {accountEmail ?? (t('googleContacts.accountUnknown') || '—')}
          </span>
        </div>
      )}

      {/* --- Last sync row (if connected) --- */}
      {isConnected && (
        <div className={rowCls}>
          <span className={labelCls}>{t('sync.last') || 'Last sync'}</span>
          <span className={valueCls}>
            {formatSyncAt(lastSyncAt)}
            {lastSyncCount !== undefined && lastSyncCount > 0 && (
              <span className={`ml-2 text-xs ${TC.textMuted}`}>
                ({lastSyncCount} {t('googleContacts.contacts') || 'contacts'})
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
              onClick={() => {
                /* Review navigation — wired by parent */
              }}
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
            {/* Sync now */}
            <button
              type="button"
              disabled={syncNowLoading}
              onClick={handleSyncNow}
              className={`px-3 py-1.5 rounded text-sm border ${TC.borderClass} ${TC.textSec} hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {syncNowLoading
                ? t('googleContacts.syncing') || 'Syncing…'
                : t('sync.now') || 'Sync now'}
            </button>

            {/* Open in Google — plain text; user copies/opens manually */}
            <button
              type="button"
              className={`px-3 py-1.5 rounded text-sm border ${TC.borderClass} ${TC.textSec} hover:opacity-80`}
              onClick={() => {
                /* External open handled by parent/Tauri shell */
              }}
            >
              {t('googleContacts.openInGoogle') || 'Open in Google'}
            </button>

            {/* Disconnect */}
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
          /* Connect Google */
          <button
            type="button"
            className="px-3 py-1.5 rounded text-sm bg-sky-600 text-white hover:bg-sky-500"
            onClick={() => {
              /* OAuth flow invoked by parent */
            }}
          >
            {t('googleContacts.connect') || 'Connect Google'}
          </button>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Disconnect confirmation — step 1: choose action                     */}
      {/* ------------------------------------------------------------------ */}
      {disconnectStep === 'choose_action' && (
        <div className={`mt-4 rounded-lg border ${TC.borderClass} ${TC.surface} p-4 space-y-3`}>
          <p className={`text-sm font-medium ${TC.text}`}>
            {t('googleContacts.disconnectTitle') || 'What to do with imported contacts?'}
          </p>

          <div className="flex flex-col gap-2">
            {/* Keep them as local */}
            <button
              type="button"
              disabled={disconnecting}
              onClick={handleKeepAndDisconnect}
              className={`w-full text-left px-3 py-2 rounded text-sm border ${TC.borderClass} ${TC.textSec} hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {t('googleContacts.keepLocal') || 'Keep them as local'}
            </button>

            {/* Delete them all */}
            <button
              type="button"
              onClick={() => setDisconnectStep('confirm_delete')}
              className="w-full text-left px-3 py-2 rounded text-sm border border-red-500/40 text-red-400 hover:opacity-80"
            >
              {t('googleContacts.deleteAll') || 'Delete them all'}
            </button>

            {/* Cancel */}
            <button
              type="button"
              onClick={handleCancelDisconnect}
              className={`w-full text-left px-3 py-2 rounded text-sm border ${TC.borderClass} ${TC.textMuted} hover:opacity-80`}
            >
              {t('common.cancel') || 'Cancel'}
            </button>
          </div>

          {/* Revoke link instruction (plain text — no href) */}
          <p className={`text-xs ${TC.textMuted}`}>
            {t('googleContacts.revokeHint') ||
              'To revoke at Google: myaccount.google.com → Security → Third-party access'}
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Disconnect confirmation — step 2: confirm delete                    */}
      {/* ------------------------------------------------------------------ */}
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
              onClick={handleDeleteConfirm}
              className="px-3 py-1.5 rounded text-sm bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {disconnecting
                ? t('googleContacts.deleting') || 'Deleting…'
                : t('googleContacts.confirmDelete') || 'Yes, delete them all'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
