/**
 * @file GeneralTab.tsx
 * Settings tab: Language, Theme, Mode, Density, Date format, Demo data.
 *
 * Rules:
 *  - No DB access in this file; all mutations go through context callbacks or props.
 *  - loadDemo is called via the injected db + deviceId, then refreshContacts is bumped.
 *  - All UI strings go through t(). No hardcoded labels.
 *  - ConfirmDialog is used for destructive or irreversible actions.
 */
import { useState, useCallback } from 'react'
import { loadDemo } from '@smart-contacts/shared'
import { useApp } from '../AppContext'
import { ConfirmDialog } from '../common'
import { ThemeSwatch } from '../icons'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeneralTabProps {
  refreshContacts: () => void
  refreshDefs: () => Promise<void>
  onToast: (msg: string) => void
}

// ---------------------------------------------------------------------------
// SettingRow helper
// ---------------------------------------------------------------------------

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  const { TC } = useApp()
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className={`text-sm font-medium ${TC.text}`}>{label}</p>
        {description && <p className={`text-xs mt-0.5 ${TC.textMuted}`}>{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toggle button group helper
// ---------------------------------------------------------------------------

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  renderLabel,
}: {
  options: T[]
  value: T
  onChange: (v: T) => void
  renderLabel?: (v: T) => React.ReactNode
}) {
  const { TC } = useApp()
  return (
    <div className={`flex rounded border overflow-hidden ${TC.borderClass}`}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-3 py-1.5 text-sm transition-colors ${
            value === opt
              ? 'bg-sky-600 text-white'
              : `${TC.elevated} ${TC.textSec} hover:opacity-80`
          }`}
        >
          {renderLabel ? renderLabel(opt) : opt}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// Theme swatch colors (bg + accent) for default and gruvbox
const THEME_COLORS: Record<string, readonly [string, string]> = {
  default: ['#1e1e2e', '#7aa2f7'],
  gruvbox: ['#282828', '#d79921'],
}

export function GeneralTab({ refreshContacts, refreshDefs, onToast }: GeneralTabProps) {
  const {
    t,
    locale,
    setLocale,
    theme,
    setTheme,
    mode,
    setMode,
    density,
    setDensity,
    TC,
    metaSettings,
    saveMeta,
    db,
    deviceId,
  } = useApp()

  // Confirm state for demo load / reset demo
  const [confirmDemo, setConfirmDemo] = useState<{ open: boolean; lang: 'en' | 'ru' } | null>(null)
  const [confirmResetDemo, setConfirmResetDemo] = useState(false)
  const [loadingDemo, setLoadingDemo] = useState(false)

  const demoSeeded = metaSettings['demo_seeded']

  const handleLoadDemo = useCallback(
    async (lang: 'en' | 'ru') => {
      if (!db || !deviceId) return
      setLoadingDemo(true)
      try {
        await loadDemo(db, deviceId, lang)
        await saveMeta('demo_seeded', lang)
        refreshContacts()
        onToast(t('demo.loaded'))
      } finally {
        setLoadingDemo(false)
        setConfirmDemo(null)
      }
    },
    [db, deviceId, saveMeta, refreshContacts, onToast, t],
  )

  const handleResetDemo = useCallback(async () => {
    if (!db) return
    await db.execute('DELETE FROM contacts')
    await db.execute('DELETE FROM custom_field_defs')
    await db.execute("DELETE FROM meta WHERE key='demo_seeded'")
    refreshContacts()
    await refreshDefs()
    setConfirmResetDemo(false)
  }, [db, refreshContacts, refreshDefs])

  return (
    <div className="space-y-1">
      {/* Language */}
      <SettingRow label={t('locale.en') + ' / ' + t('locale.ru')}>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as 'en' | 'ru')}
          className={`text-sm rounded px-2 py-1.5 border outline-none focus:ring-1 focus:ring-sky-500 ${TC.input} ${TC.inputText} ${TC.text}`}
        >
          <option value="en">{t('locale.en')}</option>
          <option value="ru">{t('locale.ru')}</option>
        </select>
      </SettingRow>

      <div className={`border-t ${TC.borderClass}`} />

      {/* Theme */}
      <SettingRow label={t('settings.title')}>
        <ToggleGroup
          options={['default', 'gruvbox'] as const}
          value={theme}
          onChange={(v) => setTheme(v as 'default' | 'gruvbox')}
          renderLabel={(v) => (
            <span className="flex items-center gap-1.5">
              <ThemeSwatch colors={THEME_COLORS[v] ?? ['#000', '#fff']} size={14} />
              {t(`theme.${v}`)}
            </span>
          )}
        />
      </SettingRow>

      <div className={`border-t ${TC.borderClass}`} />

      {/* Mode */}
      <SettingRow label={t('theme.dark') + ' / ' + t('theme.light')}>
        <ToggleGroup
          options={['dark', 'light'] as const}
          value={mode}
          onChange={(v) => setMode(v as 'dark' | 'light')}
          renderLabel={(v) => t(`theme.${v}`)}
        />
      </SettingRow>

      <div className={`border-t ${TC.borderClass}`} />

      {/* Density */}
      <SettingRow label={t('density.compact') + ' / ' + t('density.comfortable')}>
        <ToggleGroup
          options={['compact', 'comfortable'] as const}
          value={density}
          onChange={(v) => setDensity(v as 'compact' | 'comfortable')}
          renderLabel={(v) => t(`density.${v}`)}
        />
      </SettingRow>

      <div className={`border-t ${TC.borderClass}`} />

      {/* Date format */}
      <SettingRow label={t('date_format.label')}>
        <select
          value={metaSettings['date_format'] ?? 'DD.MM.YYYY'}
          onChange={(e) => void saveMeta('date_format', e.target.value)}
          className={`text-sm rounded px-2 py-1.5 border outline-none focus:ring-1 focus:ring-sky-500 ${TC.input} ${TC.inputText} ${TC.text}`}
        >
          <option value="DD.MM.YYYY">DD.MM.YYYY</option>
          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          <option value="MM/DD/YYYY">MM/DD/YYYY</option>
        </select>
      </SettingRow>

      <div className={`border-t ${TC.borderClass}`} />

      {/* Demo data */}
      <div className="py-3 space-y-2">
        <p className={`text-sm font-medium ${TC.text}`}>Demo data</p>
        {!demoSeeded ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loadingDemo}
              onClick={() => setConfirmDemo({ open: true, lang: 'en' })}
              className="px-3 py-1.5 rounded text-sm bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
            >
              {t('demo.load_en')}
            </button>
            <button
              type="button"
              disabled={loadingDemo}
              onClick={() => setConfirmDemo({ open: true, lang: 'ru' })}
              className="px-3 py-1.5 rounded text-sm bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
            >
              {t('demo.load_ru')}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className={`text-sm ${TC.textSec}`}>
              {t('demo.already_loaded', { locale: demoSeeded })}
            </p>
            <button
              type="button"
              onClick={() => setConfirmResetDemo(true)}
              className={`text-xs underline ${TC.textMuted} hover:text-red-400`}
            >
              Reset demo
            </button>
          </div>
        )}
      </div>

      {/* Confirm: load demo */}
      {confirmDemo && (
        <ConfirmDialog
          open={confirmDemo.open}
          title={t('confirm.demo_title')}
          body={t('confirm.demo_body')}
          onConfirm={() => void handleLoadDemo(confirmDemo.lang)}
          onCancel={() => setConfirmDemo(null)}
        />
      )}

      {/* Confirm: reset demo */}
      <ConfirmDialog
        open={confirmResetDemo}
        title="Reset demo data?"
        body="This deletes all contacts and custom fields. Cannot be undone."
        destructive
        onConfirm={() => void handleResetDemo()}
        onCancel={() => setConfirmResetDemo(false)}
      />
    </div>
  )
}
