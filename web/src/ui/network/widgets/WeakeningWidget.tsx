/**
 * @file WeakeningWidget.tsx
 * Renders contacts with a relationship score below 50 (weakening relationships).
 * Part of the NetworkDashboard (P8.A.6).
 * Rules: no mutations; calls onOpenContact on row click; pure presentational.
 */
import { Card } from '../Card'
import { useApp } from '../../AppContext'
import type { WeakeningItem } from '@smart-contacts/shared'
import { Heart } from '../../icons'

interface Props {
  items: WeakeningItem[]
  onOpenContact: (id: string) => void
}

export function WeakeningWidget({ items, onOpenContact }: Props) {
  const { t, TC } = useApp()
  return (
    <Card
      title={t('network.weakening')}
      count={items.length}
      emptyHint={t('network.empty.weakening')}
      isEmpty={items.length === 0}
    >
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.contact.id}>
            <button
              onClick={() => onOpenContact(it.contact.id)}
              className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:${TC.hoverBg}`}
            >
              <Heart size={12} className="flex-shrink-0 text-rose-400" />
              <span className={`truncate ${TC.text}`}>{it.contact.displayName ?? '—'}</span>
              <span className={`text-xs ${TC.textMuted} ml-auto whitespace-nowrap`}>
                Score {it.score}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
