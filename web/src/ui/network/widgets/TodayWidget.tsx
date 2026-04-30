/**
 * @file TodayWidget.tsx
 * Renders contacts with a birthday, reminder, or task due today.
 * Part of the NetworkDashboard (P8.A.6).
 * Rules: no mutations; calls onOpenContact on row click; pure presentational.
 */
import { Card } from '../Card'
import { useApp } from '../../AppContext'
import type { Contact, TodayItem } from '@smart-contacts/shared'
import { Cake, Bell, ListChecks } from '../../icons'

interface Props {
  items: TodayItem[]
  contacts: Contact[]
  onOpenContact: (id: string) => void
}

const ICON_BY_REASON = { birthday: Cake, reminder: Bell, task: ListChecks } as const

export function TodayWidget({ items, contacts, onOpenContact }: Props) {
  const { t, TC } = useApp()
  const cIndex = new Map(contacts.map((c) => [c.id, c]))
  return (
    <Card
      title={t('network.today')}
      count={items.length}
      emptyHint={t('network.empty.today')}
      isEmpty={items.length === 0}
    >
      <ul className="space-y-1">
        {items.map((it, i) => {
          const c = cIndex.get(it.contactId)
          const Icon = ICON_BY_REASON[it.reason]
          return (
            <li key={`${it.contactId}-${i}`}>
              <button
                onClick={() => onOpenContact(it.contactId)}
                className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:${TC.hoverBg}`}
              >
                <Icon size={12} className="flex-shrink-0 text-sky-400" />
                <span className={`truncate ${TC.text}`}>{c?.displayName ?? '—'}</span>
                <span className={`text-xs ${TC.textMuted} ml-auto truncate`}>{it.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
