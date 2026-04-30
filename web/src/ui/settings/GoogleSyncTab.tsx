/**
 * @file GoogleSyncTab.tsx
 * Settings tab: Google Drive appdata sync status (P4 disabled state).
 *
 * Rules:
 *  - This tab is intentionally NON-functional until P5 wires GIS sign-in.
 *  - Buttons MUST stay disabled. They exist for visual completeness only.
 *  - Once OAuth lands (P5), this file is replaced — do not add stub click handlers
 *    here that would need to be torn out.
 *  - No DB or sync engine imports; pure presentational tab.
 */
import { useApp } from '../AppContext'

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GoogleSyncTab() {
  const { TC, t } = useApp()

  const rowCls = `flex items-center justify-between py-2.5 border-b ${TC.borderClass}`
  const lastRowCls = `flex items-center justify-between py-2.5`
  const labelCls = `text-sm ${TC.textMuted}`

  return (
    <div className="space-y-1">
      {/* Status row */}
      <div className={rowCls}>
        <span className={labelCls}>{t('sync.status')}</span>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-300">
            {t('sync.not_configured')}
          </span>
        </div>
      </div>

      {/* Last sync row */}
      <div className={rowCls}>
        <span className={labelCls}>{t('sync.last')}</span>
        <span className={`text-sm ${TC.textSec}`}>{t('sync.never')}</span>
      </div>

      {/* Action buttons row */}
      <div className={lastRowCls}>
        <span className={labelCls}>&nbsp;</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            className={`px-3 py-1.5 rounded text-sm border ${TC.borderClass} ${TC.textMuted} opacity-50 cursor-not-allowed`}
          >
            {t('sync.now')}
          </button>
          <button
            type="button"
            disabled
            className={`px-3 py-1.5 rounded text-sm border border-red-500/40 text-red-400 opacity-50 cursor-not-allowed`}
          >
            {t('sync.reset')}
          </button>
        </div>
      </div>
    </div>
  )
}
