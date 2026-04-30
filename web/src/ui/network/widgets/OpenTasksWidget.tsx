/**
 * @file OpenTasksWidget.tsx
 * Renders all open tasks sorted by priority then dueAt.
 * Part of the NetworkDashboard (P8.B.3).
 * Rules: no mutations; calls onOpenContact on row click; pure presentational.
 */
import { Card } from '../Card'
import { useApp } from '../../AppContext'
import { PriorityBadge } from '../../badges'
import type { Contact, OpenTaskItem } from '@smart-contacts/shared'
import { ListChecks } from '../../icons'

interface Props {
  items: OpenTaskItem[]
  contacts: Contact[]
  onOpenContact: (id: string) => void
}

export function OpenTasksWidget({ items, contacts, onOpenContact }: Props) {
  const { t, TC } = useApp()
  const cIndex = new Map(contacts.map((c) => [c.id, c]))
  return (
    <Card
      title={t('network.open_tasks')}
      count={items.length}
      emptyHint={t('network.empty.open_tasks')}
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
                <ListChecks size={12} className="flex-shrink-0 text-green-400" />
                {it.task.priority !== undefined && <PriorityBadge priority={it.task.priority} />}
                <span className={`truncate ${TC.text}`}>{c?.displayName ?? '—'}</span>
                <span className={`text-xs ${TC.textMuted} ml-auto truncate`}>{it.task.text}</span>
                {it.task.dueAt && (
                  <span className="text-[10px] text-sky-400 ml-2 whitespace-nowrap">
                    {it.task.dueAt.slice(0, 10)}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
