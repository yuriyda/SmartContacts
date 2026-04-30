/**
 * @file SettingsDialog.tsx
 * Modal settings dialog with a two-column layout: left tab rail + right content pane.
 *
 * Rules:
 *  - Renders null when open === false.
 *  - Esc closes via onClose. Cmd/Ctrl+, is handled by SmartContactsApp (parent).
 *  - Tab switching is local state; no URL routing.
 *  - Per-tab logic lives in dedicated tab components under ./settings/.
 *  - Toast state is managed here and passed down as onToast callbacks.
 *  - All destructive actions in tabs go through ConfirmDialog within each tab.
 *  - No `any` types.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { Contact, CustomFieldDef } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { ToastContainer } from './common'
import { X, Settings } from './icons'
import { GeneralTab } from './settings/GeneralTab'
import { CustomFieldsTab } from './settings/CustomFieldsTab'
import { BackupTab } from './settings/BackupTab'
import { AboutTab } from './settings/AboutTab'
import { GoogleSyncTab } from './settings/GoogleSyncTab'
import { OnboardingTab } from './settings/OnboardingTab'
import { ulid } from '@smart-contacts/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabKey = 'general' | 'custom_fields' | 'backup' | 'google_sync' | 'about' | 'onboarding'

export interface SettingsDialogProps {
  open: boolean
  initialTab?: TabKey
  onClose: () => void
  contacts: Contact[]
  defs: CustomFieldDef[]
  refreshDefs: () => Promise<void>
  refreshContacts: () => void
  onResetGuide: () => Promise<void>
}

interface ToastEntry {
  id: string
  message: string
}

// ---------------------------------------------------------------------------
// Tab list definition
// ---------------------------------------------------------------------------

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'general', labelKey: 'settings.tabs.general' },
  { key: 'custom_fields', labelKey: 'settings.tabs.custom_fields' },
  { key: 'backup', labelKey: 'settings.tabs.backup' },
  { key: 'google_sync', labelKey: 'settings.tabs.google_sync' },
  { key: 'about', labelKey: 'settings.tabs.about' },
  { key: 'onboarding', labelKey: 'settings.tabs.onboarding' },
]

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettingsDialog({
  open,
  initialTab = 'general',
  onClose,
  contacts: _contacts,
  defs,
  refreshDefs,
  refreshContacts,
  onResetGuide,
}: SettingsDialogProps) {
  const { TC, t } = useApp()
  const [tab, setTab] = useState<TabKey>(initialTab)
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const panelRef = useRef<HTMLDivElement>(null)

  // Reset tab to initialTab when dialog reopens
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  // Esc closes
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open, onClose])

  const addToast = useCallback((msg: string) => {
    const id = ulid()
    setToasts((prev) => [...prev, { id, message: msg }])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        {/* Panel */}
        <div
          ref={panelRef}
          className={`${TC.surface} w-full max-w-4xl max-h-[90vh] flex rounded-lg shadow-2xl border ${TC.borderClass}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Left rail ── */}
          <div
            className={`w-60 flex-shrink-0 flex flex-col border-r ${TC.borderClass} rounded-l-lg overflow-hidden`}
          >
            {/* Header */}
            <div
              className={`flex items-center justify-between px-4 py-3 border-b ${TC.borderClass}`}
            >
              <span className={`flex items-center gap-2 text-sm font-semibold ${TC.text}`}>
                <Settings size={15} />
                {t('settings.title')}
              </span>
              <button
                type="button"
                onClick={onClose}
                className={`p-1 rounded hover:opacity-70 ${TC.textMuted}`}
                aria-label="Close settings"
              >
                <X size={15} />
              </button>
            </div>

            {/* Tab list */}
            <nav className="flex-1 py-2">
              {TABS.map(({ key, labelKey }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                    tab === key ? 'bg-sky-600/20 text-sky-300' : `${TC.textSec} hover:opacity-80`
                  }`}
                >
                  {t(labelKey)}
                </button>
              ))}
            </nav>
          </div>

          {/* ── Right pane ── */}
          <div className="flex-1 flex flex-col min-w-0 rounded-r-lg overflow-hidden">
            <div className={`px-6 py-4 border-b ${TC.borderClass}`}>
              <h2 className={`text-base font-semibold ${TC.text}`}>
                {t(TABS.find((x) => x.key === tab)?.labelKey ?? 'settings.title')}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {tab === 'general' && (
                <GeneralTab
                  refreshContacts={refreshContacts}
                  refreshDefs={refreshDefs}
                  onToast={addToast}
                />
              )}
              {tab === 'custom_fields' && (
                <CustomFieldsTab defs={defs} refreshDefs={refreshDefs} onToast={addToast} />
              )}
              {tab === 'backup' && (
                <BackupTab
                  refreshContacts={refreshContacts}
                  refreshDefs={refreshDefs}
                  onToast={addToast}
                />
              )}
              {tab === 'google_sync' && <GoogleSyncTab />}
              {tab === 'about' && <AboutTab onToast={addToast} />}
              {tab === 'onboarding' && <OnboardingTab onResetGuide={onResetGuide} />}
            </div>
          </div>
        </div>
      </div>

      {/* Toast container outside modal so it's always on top */}
      <ToastContainer
        toasts={toasts.map((t) => ({ id: t.id, message: t.message }))}
        onDismiss={dismissToast}
      />
    </>
  )
}
