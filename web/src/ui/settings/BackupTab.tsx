/**
 * @file BackupTab.tsx
 * Settings tab: Export, Import (Merge / Replace), and Reset all data.
 *
 * Rules:
 *  - exportBackup and importBackup are called via props-injected db.
 *  - All destructive actions go through ConfirmDialog.
 *  - Import file is read and parsed; bundle.version === 1 is validated before any write.
 *  - No `any` types.
 *  - When running inside Tauri, window.__SMART_CONTACTS_NATIVE__ is used for file dialogs
 *    instead of browser blob URLs / <input type="file">. No direct @tauri-apps/* imports here.
 */
import { useState, useRef, useCallback } from 'react'
import type { BackupBundle } from '@smart-contacts/shared'
import { exportBackup, importBackup } from '@smart-contacts/shared'
import { useApp } from '../AppContext'
import { ConfirmDialog } from '../common'
import { Download, Upload } from '../icons'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BackupTabProps {
  refreshContacts: () => void
  refreshDefs: () => Promise<void>
  onToast: (msg: string) => void
}

// Native bridge contract — mirrors tauri/src/native-bridge.ts but without direct import.
// window.__SMART_CONTACTS_NATIVE__ is populated by tauri/src/main.tsx at startup.
declare global {
  interface Window {
    __SMART_CONTACTS_NATIVE__?: {
      pickSaveLocation: (filename: string) => Promise<{ path: string; filename: string } | null>
      writeTextToFile: (path: string, content: string) => Promise<void>
      pickAndReadJsonFile: () => Promise<{ path: string; content: string } | null>
    }
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BackupTab({ refreshContacts, refreshDefs, onToast }: BackupTabProps) {
  const { TC, t, db, saveMeta } = useApp()

  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingBundle, setPendingBundle] = useState<BackupBundle | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [importing, setImporting] = useState(false)
  const [includeHidden, setIncludeHidden] = useState(false)

  // ----- Export -----

  const handleExport = useCallback(async () => {
    if (!db) return
    const bundle = await exportBackup(db, { includeHidden })
    const json = JSON.stringify(bundle, null, 2)
    const suggestedName = `contacts-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`

    const native = window.__SMART_CONTACTS_NATIVE__
    if (native) {
      const pick = await native.pickSaveLocation(suggestedName)
      if (!pick) return // user cancelled
      await native.writeTextToFile(pick.path, json)
      onToast(t('backup.exported_native'))
    } else {
      // Browser fallback: download via blob URL
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = suggestedName
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [db, includeHidden, onToast, t])

  // ----- Import: file picked via browser input -----

  const handleFilePicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const raw = JSON.parse(ev.target?.result as string) as unknown
          const bundle = raw as BackupBundle
          if (bundle.version !== 1) {
            onToast('Unsupported backup version')
            return
          }
          setPendingBundle(bundle)
        } catch {
          onToast('Failed to parse backup file')
        }
      }
      reader.readAsText(file)
      // Reset input so same file can be picked again
      e.target.value = ''
    },
    [onToast],
  )

  // ----- Import: click handler — uses native dialog if available -----

  const handleImportClick = useCallback(async () => {
    const native = window.__SMART_CONTACTS_NATIVE__
    if (native) {
      const result = await native.pickAndReadJsonFile()
      if (!result) return // user cancelled
      try {
        const raw = JSON.parse(result.content) as unknown
        const bundle = raw as BackupBundle
        if (bundle.version !== 1) {
          onToast('Unsupported backup version')
          return
        }
        setPendingBundle(bundle)
      } catch {
        onToast('Failed to parse backup file')
      }
    } else {
      // Browser fallback: trigger file input
      fileRef.current?.click()
    }
  }, [onToast])

  const doImport = useCallback(
    async (mode: 'merge' | 'replace') => {
      if (!db || !pendingBundle) return
      setImporting(true)
      try {
        const result = await importBackup(db, pendingBundle, mode)
        refreshContacts()
        await refreshDefs()
        onToast(
          t('backup.imported', {
            inserted: result.inserted,
            updated: result.updated,
            skipped: result.skipped,
          }),
        )
      } finally {
        setPendingBundle(null)
        setImporting(false)
        setConfirmReplace(false)
      }
    },
    [db, pendingBundle, refreshContacts, refreshDefs, onToast, t],
  )

  // ----- Reset all data -----

  const handleResetAll = useCallback(async () => {
    if (!db) return
    await db.transaction(async (tx) => {
      await tx.execute('DELETE FROM contacts')
      await tx.execute('DELETE FROM custom_field_defs')
      await tx.execute('DELETE FROM avatars')
      await tx.execute("DELETE FROM meta WHERE key NOT IN ('device_id', 'schema_version')")
    })
    refreshContacts()
    await refreshDefs()
    await saveMeta('demo_seeded', '')
    setConfirmReset(false)
    onToast('All data reset')
  }, [db, refreshContacts, refreshDefs, saveMeta, onToast])

  return (
    <div className="space-y-6">
      {/* Export */}
      <div className="space-y-2">
        <h3 className={`text-xs font-semibold uppercase tracking-wider ${TC.textMuted}`}>Export</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeHidden}
            onChange={(e) => setIncludeHidden(e.target.checked)}
          />
          <span className={TC.textSec}>{t('backup.include_hidden')}</span>
        </label>
        <button
          type="button"
          onClick={() => void handleExport()}
          className={`flex items-center gap-2 px-3 py-2 rounded text-sm border ${TC.borderClass} ${TC.textSec} hover:opacity-80`}
        >
          <Download size={14} />
          {t('backup.export')}
        </button>
      </div>

      {/* Import */}
      <div className="space-y-2">
        <h3 className={`text-xs font-semibold uppercase tracking-wider ${TC.textMuted}`}>Import</h3>
        {/* Hidden file input — used in browser mode only */}
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={handleFilePicked}
        />
        <button
          type="button"
          onClick={() => void handleImportClick()}
          className={`flex items-center gap-2 px-3 py-2 rounded text-sm border ${TC.borderClass} ${TC.textSec} hover:opacity-80`}
        >
          <Upload size={14} />
          {t('backup.import')}
        </button>

        {/* Mode choice after file parsed */}
        {pendingBundle && (
          <div className={`p-3 rounded border ${TC.borderClass} ${TC.elevated} space-y-2`}>
            <p className={`text-sm ${TC.text}`}>
              Backup from {pendingBundle.exportedAt.slice(0, 10)}:&nbsp;
              {pendingBundle.contacts.length} contacts,&nbsp;
              {pendingBundle.customFieldDefs.length} field defs.
            </p>
            <p className={`text-xs ${TC.textMuted}`}>Choose import mode:</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={importing}
                onClick={() => void doImport('merge')}
                className="px-3 py-1.5 text-sm rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
              >
                {t('backup.merge')}
              </button>
              <button
                type="button"
                disabled={importing}
                onClick={() => setConfirmReplace(true)}
                className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
              >
                {t('backup.replace')}
              </button>
              <button
                type="button"
                onClick={() => setPendingBundle(null)}
                className={`px-3 py-1.5 text-sm rounded ${TC.elevated} ${TC.textSec} hover:opacity-80`}
              >
                {t('actions.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Reset all data */}
      <div className="space-y-2">
        <h3 className={`text-xs font-semibold uppercase tracking-wider ${TC.textMuted}`}>
          Danger zone
        </h3>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="px-3 py-2 text-sm rounded border border-red-600 text-red-500 hover:bg-red-600/10"
        >
          Reset all data…
        </button>
        <p className={`text-xs ${TC.textMuted}`}>{t('confirm.reset_body')}</p>
      </div>

      {/* Confirm: replace import */}
      <ConfirmDialog
        open={confirmReplace}
        title={t('confirm.replace_title')}
        body={t('confirm.replace_body')}
        destructive
        onConfirm={() => void doImport('replace')}
        onCancel={() => setConfirmReplace(false)}
      />

      {/* Confirm: reset all */}
      <ConfirmDialog
        open={confirmReset}
        title={t('confirm.reset_title')}
        body={t('confirm.reset_body')}
        destructive
        onConfirm={() => void handleResetAll()}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
