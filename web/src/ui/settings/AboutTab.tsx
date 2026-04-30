/**
 * @file AboutTab.tsx
 * Settings tab: App name, version, device ID, GitHub link, license.
 *
 * Rules:
 *  - Version is read from VITE_APP_VERSION env var (injected by vite.config.ts).
 *  - Device ID is read from useDb().deviceId.
 *  - Copy button uses navigator.clipboard.writeText; shows a toast on success.
 *  - No DB access in this file.
 */
import { useApp } from '../AppContext'
import { Copy } from '../icons'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AboutTabProps {
  onToast: (msg: string) => void
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AboutTab({ onToast }: AboutTabProps) {
  const { TC, t, deviceId } = useApp()

  // Version injected by vite define; fallback to '0.0.0' in test env
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metaEnv = (import.meta as any).env as Record<string, string> | undefined
  const version = metaEnv?.['VITE_APP_VERSION'] ?? '0.0.0'

  const handleCopyDeviceId = async () => {
    if (!deviceId) return
    await navigator.clipboard.writeText(deviceId)
    onToast(t('actions.copy') + ': device ID')
  }

  const rowCls = `flex items-center justify-between py-2.5 border-b ${TC.borderClass}`
  const labelCls = `text-sm ${TC.textMuted}`
  const valueCls = `text-sm ${TC.text}`

  return (
    <div className="space-y-1">
      <div className={rowCls}>
        <span className={labelCls}>App</span>
        <span className={valueCls}>Smart Contacts</span>
      </div>
      <div className={rowCls}>
        <span className={labelCls}>Version</span>
        <span className={`${valueCls} font-mono`}>v{version}</span>
      </div>
      <div className={rowCls}>
        <span className={labelCls}>Device ID</span>
        <span className="flex items-center gap-2">
          <span className={`text-xs font-mono max-w-xs truncate ${TC.textSec}`}>
            {deviceId ?? '—'}
          </span>
          {deviceId && (
            <button
              type="button"
              onClick={() => void handleCopyDeviceId()}
              className={`p-1 rounded hover:opacity-70 ${TC.textMuted}`}
              aria-label="Copy device ID"
            >
              <Copy size={12} />
            </button>
          )}
        </span>
      </div>
      <div className={rowCls}>
        <span className={labelCls}>Repository</span>
        <a
          href="https://github.com/yuriyda/SmartContacts"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-sky-400 hover:text-sky-300"
        >
          github.com/yuriyda/SmartContacts
        </a>
      </div>
      <div className={`flex items-center justify-between py-2.5`}>
        <span className={labelCls}>License</span>
        <span className={valueCls}>MIT</span>
      </div>
    </div>
  )
}
