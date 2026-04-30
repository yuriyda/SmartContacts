/**
 * @file StaleWidget.tsx
 * Renders contacts whose last-contact date exceeds the stale threshold for their priority.
 * Part of the NetworkDashboard (P8.A.6).
 * Rules: no mutations; calls onOpenContact on row click; pure presentational.
 */
import { Card } from '../Card'
import { useApp } from '../../AppContext'
import type { StaleItem } from '@smart-contacts/shared'
import { Clock } from '../../icons'

interface Props {
  items: StaleItem[]
  onOpenContact: (id: string) => void
}

export function StaleWidget({ items, onOpenContact }: Props) {
  const { t, TC } = useApp()
  return (
    <Card
      title={t('network.stale')}
      count={items.length}
      emptyHint={t('network.empty.stale')}
      isEmpty={items.length === 0}
    >
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.contact.id}>
            <button
              onClick={() => onOpenContact(it.contact.id)}
              className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:${TC.hoverBg}`}
            >
              <Clock size={12} className="flex-shrink-0 text-amber-400" />
              <span className={`truncate ${TC.text}`}>{it.contact.displayName ?? '—'}</span>
              <span className={`text-xs ${TC.textMuted} ml-auto whitespace-nowrap`}>
                +{it.daysOverdue}d
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
