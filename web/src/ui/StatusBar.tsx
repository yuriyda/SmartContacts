/**
 * @file StatusBar.tsx
 * Bottom status bar for Smart Contacts: contact counter, sync placeholder, and toggle controls.
 * Modeled after TaskOrchestrator/tauri-app/src/ui/StatusBar.tsx layout and visual grammar.
 * Rules: reads TC/locale/theme/mode/density from AppContext; no direct DB access.
 */
import { themes } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { Sun, Moon, ChevronsDown, ChevronsUp, RefreshCw, ThemeSwatch } from './icons'

interface StatusBarProps {
  total: number
  filtered: number
  onLocaleToggle: () => void
  onThemeToggle: () => void
  onModeToggle: () => void
  onDensityToggle: () => void
  filterIsNonTrivial: boolean
  onSaveFilter: () => void
}

export function StatusBar({
  total,
  filtered,
  onLocaleToggle,
  onThemeToggle,
  onModeToggle,
  onDensityToggle,
  filterIsNonTrivial,
  onSaveFilter,
}: StatusBarProps) {
  const { TC, t, locale, theme, mode, density, db } = useApp()

  const isFiltered = filtered !== total
  const countLabel = isFiltered
    ? t('status.contacts_filtered', { filtered, total })
    : t('status.contacts', { count: total })

  // Resolve swatches for the current theme to pass to ThemeSwatch.
  const swatches = themes.COLOR_THEMES[theme]?.swatches ?? ['#0ea5e9', '#374151']

  return (
    <footer
      className={`flex items-center px-4 h-8 border-t ${TC.borderClass} ${TC.header} text-xs select-none`}
    >
      {/* Left — count or loading */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {db === null ? (
          <span className={`flex items-center gap-1.5 ${TC.textSec}`}>
            <RefreshCw size={10} className="animate-spin" />
            {t('status.loading')}
          </span>
        ) : (
          <span className={TC.textSec}>{countLabel}</span>
        )}
      </div>

      {/* Save filter button — shown only when current filter is non-trivial */}
      {filterIsNonTrivial && (
        <button
          type="button"
          onClick={onSaveFilter}
          className={`px-2 py-0.5 rounded ${TC.textSec} hover:${TC.text} hover:bg-sky-600/20`}
        >
          {t('actions.save_filter')}
        </button>
      )}

      {/* Centre — sync placeholder */}
      <div className={`flex-1 text-center ${TC.textMuted}`}>{t('status.sync_pending')}</div>

      {/* Right — toggles */}
      <div className="flex items-center gap-1 flex-1 justify-end">
        {/* Locale toggle */}
        <button
          onClick={onLocaleToggle}
          className={`px-2 py-0.5 rounded text-xs transition-colors ${TC.textSec} hover:${TC.text}`}
          aria-label={t('hotkey.settings')}
          title={locale === 'en' ? 'Switch to Russian' : 'Switch to English'}
        >
          {locale === 'en' ? 'RU' : 'EN'}
        </button>

        {/* Theme toggle — shows swatches */}
        <button
          onClick={onThemeToggle}
          className={`p-1 rounded transition-colors ${TC.textSec} hover:${TC.text}`}
          aria-label="Toggle color theme"
          title={`Theme: ${theme}`}
        >
          <ThemeSwatch colors={swatches} size={14} />
        </button>

        {/* Mode toggle (dark / light) */}
        <button
          onClick={onModeToggle}
          className={`p-1 rounded transition-colors ${TC.textSec} hover:${TC.text}`}
          aria-label={t('hotkey.settings')}
          title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {mode === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
        </button>

        {/* Density toggle */}
        <button
          onClick={onDensityToggle}
          className={`p-1 rounded transition-colors ${TC.textSec} hover:${TC.text}`}
          aria-label="Toggle density"
          title={
            density === 'compact' ? 'Switch to comfortable density' : 'Switch to compact density'
          }
        >
          {density === 'compact' ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
        </button>
      </div>
    </footer>
  )
}
