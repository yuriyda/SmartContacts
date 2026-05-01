/**
 * @file CenterTabBar.tsx
 * Underlined tab bar at the top of the central column — switches Contacts ↔ Network views.
 * Rules: presentational only; receives state and onChange callback from parent.
 * Do NOT add DB access or side-effects here.
 */
import { useApp } from './AppContext'

interface CenterTabBarProps {
  activeView: 'contacts' | 'network'
  onChangeView: (v: 'contacts' | 'network') => void
}

export function CenterTabBar({ activeView, onChangeView }: CenterTabBarProps) {
  const { t, TC } = useApp()
  return (
    <div className={`flex border-b ${TC.borderClass} px-3 flex-shrink-0`}>
      {(['contacts', 'network'] as const).map((v) => {
        const active = activeView === v
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChangeView(v)}
            className={[
              'px-4 py-2 text-sm transition-colors border-b-2 -mb-px',
              active
                ? `border-sky-500 text-sky-300`
                : `border-transparent ${TC.textMuted} hover:${TC.text}`,
            ].join(' ')}
          >
            {t(`nav.tab.${v}` as 'nav.tab.contacts' | 'nav.tab.network')}
          </button>
        )
      })}
    </div>
  )
}
