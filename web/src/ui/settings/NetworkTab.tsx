/**
 * @file NetworkTab.tsx
 * Settings tab: Network feature controls — stale thresholds, my_city, show_score.
 * Spec §15.10 / §15.5.
 *
 * Rules:
 *  - Persists in meta_settings: stale_thresholds_v1 (JSON), my_city_v1 (string), show_score_v1 ('0'|'1').
 *  - On change of threshold field: write JSON immediately to meta. On blur, validate and revert if NaN.
 *  - No `any` types.
 */
import { useState, useCallback, useEffect } from 'react'
import { DEFAULT_STALE_THRESHOLDS } from '@smart-contacts/shared'
import { useApp } from '../AppContext'
import { readStaleThresholds, readShowScore, readMyCity } from '../../store/networkSettings'

interface NetworkTabProps {
  onToast: (msg: string) => void
}

export function NetworkTab({ onToast }: NetworkTabProps) {
  const { TC, t, metaSettings, saveMeta } = useApp()

  // Local editing state for thresholds (debounced flush on blur).
  const persisted = readStaleThresholds(metaSettings)
  const [thresholds, setThresholds] = useState<Record<1 | 2 | 3 | 4 | 5, string>>({
    1: String(persisted[1]),
    2: String(persisted[2]),
    3: String(persisted[3]),
    4: String(persisted[4]),
    5: String(persisted[5]),
  })
  const [city, setCity] = useState(readMyCity(metaSettings))
  const showScore = readShowScore(metaSettings)

  // Re-sync local state when metaSettings change externally
  useEffect(() => {
    const p = readStaleThresholds(metaSettings)
    setThresholds({
      1: String(p[1]),
      2: String(p[2]),
      3: String(p[3]),
      4: String(p[4]),
      5: String(p[5]),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaSettings.stale_thresholds_v1])

  const flushThresholds = useCallback(async () => {
    const out: Record<string, number> = {}
    for (const k of [1, 2, 3, 4, 5] as const) {
      const n = parseInt(thresholds[k], 10)
      if (!Number.isFinite(n) || n <= 0) {
        onToast(t('settings.network.threshold_invalid', { p: String(k) }))
        return
      }
      out[String(k)] = n
    }
    await saveMeta('stale_thresholds_v1', JSON.stringify(out))
    onToast(t('settings.network.thresholds_saved'))
  }, [thresholds, saveMeta, onToast, t])

  const flushCity = useCallback(async () => {
    await saveMeta('my_city_v1', city)
  }, [city, saveMeta])

  const toggleShowScore = useCallback(
    async (v: boolean) => {
      await saveMeta('show_score_v1', v ? '1' : '0')
    },
    [saveMeta],
  )

  const resetThresholds = useCallback(async () => {
    setThresholds({
      1: String(DEFAULT_STALE_THRESHOLDS[1]),
      2: String(DEFAULT_STALE_THRESHOLDS[2]),
      3: String(DEFAULT_STALE_THRESHOLDS[3]),
      4: String(DEFAULT_STALE_THRESHOLDS[4]),
      5: String(DEFAULT_STALE_THRESHOLDS[5]),
    })
    await saveMeta('stale_thresholds_v1', JSON.stringify(DEFAULT_STALE_THRESHOLDS))
    onToast(t('settings.network.thresholds_reset'))
  }, [saveMeta, onToast, t])

  return (
    <div className="space-y-5">
      <div>
        <h4 className={`text-sm font-medium ${TC.text} mb-2`}>
          {t('settings.network.thresholds_label')}
        </h4>
        <p className={`text-xs ${TC.textMuted} mb-3`}>{t('settings.network.thresholds_body')}</p>
        <div className="grid grid-cols-5 gap-2">
          {([1, 2, 3, 4, 5] as const).map((p) => (
            <label key={p} className="flex flex-col gap-1">
              <span className={`text-xs ${TC.textSec}`}>
                {t('priority.label')} {p}
              </span>
              <input
                type="number"
                min={1}
                value={thresholds[p]}
                onChange={(e) => setThresholds((prev) => ({ ...prev, [p]: e.target.value }))}
                onBlur={() => void flushThresholds()}
                className={`px-2 py-1 rounded border ${TC.borderClass} ${TC.elevated} ${TC.text} text-sm`}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void resetThresholds()}
          className={`mt-2 text-xs ${TC.textMuted} hover:${TC.text} underline`}
        >
          {t('settings.network.reset_thresholds')}
        </button>
      </div>

      <div>
        <label className="block">
          <span className={`text-sm ${TC.text}`}>{t('settings.network.my_city_label')}</span>
          <p className={`text-xs ${TC.textMuted} mt-1 mb-2`}>
            {t('settings.network.my_city_body')}
          </p>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onBlur={() => void flushCity()}
            className={`w-full px-2 py-1 rounded border ${TC.borderClass} ${TC.elevated} ${TC.text} text-sm`}
            placeholder={t('settings.network.my_city_placeholder')}
          />
        </label>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showScore}
            onChange={(e) => void toggleShowScore(e.target.checked)}
          />
          <span className={TC.text}>{t('settings.network.show_score_label')}</span>
        </label>
        <p className={`text-xs ${TC.textMuted} ml-6 mt-1`}>
          {t('settings.network.show_score_body')}
        </p>
      </div>
    </div>
  )
}
