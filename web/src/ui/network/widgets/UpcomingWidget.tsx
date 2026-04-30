/**
 * @file UpcomingWidget.tsx
 * Renders open tasks due in the next 1–7 days (upcoming tasks).
 * Part of the NetworkDashboard (P8.B.3).
 * Rules: no mutations; calls onOpenContact on row click; pure presentational.
 */
import { Card } from '../Card'
import { useApp } from '../../AppContext'
import type { Contact, UpcomingItem } from '@smart-contacts/shared'
import { CalendarClock } from '../../icons'

interface Props {
  items: UpcomingItem[]
  contacts: Contact[]
  onOpenContact: (id: string) => void
}

export function UpcomingWidget({ items, contacts, onOpenContact }: Props) {
  const { t, TC } = useApp()
  const cIndex = new Map(contacts.map((c) => [c.id, c]))
  return (
    <Card
      title={t('network.upcoming')}
      count={items.length}
      emptyHint={t('network.empty.upcoming')}
      isEmpty={items.length === 0}
    >
      <ul className="space-y-1">
        {items.map((it) => {
          const c = cIndex.get(it.task.contactId)
          return (
            <li key={it.task.id}>
              <button
                onClick={() => onOpenContact(it.task.contactId)}
                className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:${TC.hoverBg}`}
              >
                <CalendarClock size={12} className="flex-shrink-0 text-sky-400" />
                <span className={`truncate ${TC.text}`}>{c?.displayName ?? '—'}</span>
                <span className={`text-xs ${TC.textMuted} ml-auto truncate`}>{it.task.text}</span>
                <span className="text-[10px] text-amber-400 ml-2 whitespace-nowrap">
                  +{it.daysUntilDue}d
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
