/**
 * @file PrivacyTab.tsx
 * Settings tab: Privacy controls — auto-protect (mark high-priority contacts as protected).
 * Rules:
 *  - State persists in meta_settings: auto_protect_enabled_v1, auto_protect_threshold_v1.
 *  - "Apply now" performs a one-shot pass: contacts with priority <= threshold AND !protected
 *    get protected = true (via upsert which bumps lamport_ts).
 *  - No `any` types.
 */
import { useCallback, useState } from 'react'
import type { Contact } from '@smart-contacts/shared'
import { useApp } from '../AppContext'

interface PrivacyTabProps {
  contacts: Contact[]
  upsert: (c: Contact) => Promise<Contact | null>
  onToast: (msg: string) => void
}

export function PrivacyTab({ contacts, upsert, onToast }: PrivacyTabProps) {
  const { TC, t, metaSettings, saveMeta } = useApp()
  const enabled = metaSettings.auto_protect_enabled_v1 === '1'
  const threshold = parseInt(metaSettings.auto_protect_threshold_v1 ?? '2', 10) as 1 | 2 | 3 | 4 | 5

  const [busy, setBusy] = useState(false)

  const toggleEnabled = useCallback(
    async (next: boolean) => {
      await saveMeta('auto_protect_enabled_v1', next ? '1' : '0')
    },
    [saveMeta],
  )

  const onChangeThreshold = useCallback(
    async (n: number) => {
      await saveMeta('auto_protect_threshold_v1', String(n))
    },
    [saveMeta],
  )

  const apply = useCallback(async () => {
    setBusy(true)
    let count = 0
    try {
      for (const c of contacts) {
        if (!c.deletedAt && !c.protected && (c.priority ?? 5) <= threshold) {
          await upsert({ ...c, protected: true })
          count++
        }
      }
      onToast(t('settings.auto_protect.applied', { n: count }))
    } finally {
      setBusy(false)
    }
  }, [contacts, threshold, upsert, t, onToast])

  return (
    <div className="space-y-4">
      <div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => void toggleEnabled(e.target.checked)}
          />
          <span className={TC.text}>{t('settings.auto_protect.label')}</span>
        </label>
        <p className={`text-xs ${TC.textMuted} mt-1 ml-6`}>{t('settings.auto_protect.body')}</p>
      </div>

      <div className="flex items-center gap-3 ml-6">
        <span className={`text-sm ${TC.textSec}`}>
          {t('settings.auto_protect.threshold_label')}
        </span>
        <select
          value={threshold}
          onChange={(e) => void onChangeThreshold(Number(e.target.value))}
          disabled={!enabled}
          className={`px-2 py-1 rounded border ${TC.borderClass} ${TC.elevated} ${TC.text} text-sm`}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void apply()}
          disabled={!enabled || busy}
          className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm disabled:opacity-50"
        >
          {t('settings.auto_protect.apply_now')}
        </button>
      </div>
    </div>
  )
}
