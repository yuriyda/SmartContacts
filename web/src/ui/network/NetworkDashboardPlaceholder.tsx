/**
 * @file NetworkDashboardPlaceholder.tsx
 * Placeholder rendered when activeView === 'network' (P8.A.5).
 * Will be replaced by the real <NetworkDashboard> in P8.A.6.
 * Rules: no logic; visual stub only.
 */
import { useApp } from '../AppContext'

export function NetworkDashboardPlaceholder() {
  const { TC, t } = useApp()
  return (
    <div className={`flex-1 flex items-center justify-center ${TC.text} text-sm`}>
      {t('network.placeholder')}
    </div>
  )
}
