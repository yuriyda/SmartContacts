/**
 * @file NetworkDashboard.tsx
 * Replaces MainList + ContactDetail when activeView === 'network' (P8.A.6).
 * Renders Today / Stale / Weakening widgets in a responsive grid.
 * Hidden contacts are excluded by the upstream contact filter (sidebar scope),
 * except when user explicitly selects the Hidden scope.
 * Rules: no direct DB access; receives pre-filtered contacts and pre-fetched data.
 */
import { useMemo } from 'react'
import type { Contact, Interaction, ContactTask } from '@smart-contacts/shared'
import { computeTodayItems, computeStaleItems, computeWeakeningItems } from '@smart-contacts/shared'
import type { StaleThresholds } from '../../store/networkSettings'
import { TodayWidget } from './widgets/TodayWidget'
import { StaleWidget } from './widgets/StaleWidget'
import { WeakeningWidget } from './widgets/WeakeningWidget'

interface Props {
  contacts: Contact[] // already filtered by sidebar (hidden excluded by default)
  recentInteractions: Interaction[]
  openTasks: ContactTask[]
  onOpenContact: (id: string) => void
  /** Stale thresholds from meta settings; passed from SmartContactsApp. */
  thresholds: StaleThresholds
}

export function NetworkDashboard({
  contacts,
  recentInteractions,
  openTasks,
  onOpenContact,
  thresholds,
}: Props) {
  const now = new Date()

  const today = useMemo(
    () => computeTodayItems(contacts, openTasks, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts, openTasks],
  )

  const stale = useMemo(
    () => computeStaleItems(contacts, thresholds, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts, thresholds],
  )

  const weakening = useMemo(() => {
    const map = new Map<string, number>()
    for (const i of recentInteractions) {
      if (i.deletedAt) continue
      map.set(i.contactId, (map.get(i.contactId) ?? 0) + 1)
    }
    return computeWeakeningItems(contacts, map, now)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, recentInteractions])

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <TodayWidget items={today} contacts={contacts} onOpenContact={onOpenContact} />
        <StaleWidget items={stale} onOpenContact={onOpenContact} />
        <WeakeningWidget items={weakening} onOpenContact={onOpenContact} />
      </div>
    </div>
  )
}
