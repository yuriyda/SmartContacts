/**
 * @file useNotificationScheduler.ts
 * In-page Notification API scheduler.
 *
 * Behavior:
 *  - Active when meta.notifications_enabled_v1 === '1'.
 *  - Reads notify_time_v1 (HH format, e.g. '09'). Default 9.
 *  - On mount AND every 60 seconds: checks shouldFireNow(now, last_fired_v1).
 *    If true AND wall-clock time >= configured hour, fires one consolidated Notification
 *    summarizing today's items via buildDailySummary().
 *  - On fire: writes meta.last_fired_v1 = now.toISOString().
 *
 * Limitations vs SW path:
 *  - Fires only while the tab is open.
 *  - User must keep at least one Smart Contacts tab alive overnight to receive morning fire.
 *  - Notification permission must be granted (handled by NetworkTab UI).
 *
 * Rules: no DB writes (only meta via saveMeta from caller); no React imports outside hook.
 */
import { useEffect, useRef } from 'react'
import type { Contact, ContactTask } from '@smart-contacts/shared'
import { buildDailySummary, computeTodayItems, shouldFireNow } from '@smart-contacts/shared'

interface SchedulerInput {
  enabled: boolean
  hourStr: string // e.g. '09'
  lastFiredISO: string | undefined
  contacts: Contact[]
  openTasks: ContactTask[]
  saveMeta: (key: string, value: string) => Promise<void>
  i18nTitle: string // pre-localized
  i18nEmpty: string
  /** Override for tests; default uses Notification API */
  fireFn?: (title: string, body: string) => void
}

export function useNotificationScheduler({
  enabled,
  hourStr,
  lastFiredISO,
  contacts,
  openTasks,
  saveMeta,
  i18nTitle,
  i18nEmpty,
  fireFn,
}: SchedulerInput): void {
  const tickRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return undefined
    const tick = async () => {
      const now = new Date()
      const hour = parseInt(hourStr || '9', 10)
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) return
      if (now.getHours() < hour) return
      if (!shouldFireNow(now, lastFiredISO)) return

      const items = computeTodayItems(contacts, openTasks, now)
      const cMap = new Map(contacts.map((c) => [c.id, c]))
      const summary = buildDailySummary(items, cMap, i18nTitle, i18nEmpty)
      if (!summary) return

      const fire = fireFn ?? defaultFire
      fire(summary.title, summary.body)
      await saveMeta('last_fired_v1', now.toISOString())
    }

    void tick() // run immediately on mount
    tickRef.current = window.setInterval(() => void tick(), 60_000)
    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current)
        tickRef.current = null
      }
    }
  }, [enabled, hourStr, lastFiredISO, contacts, openTasks, saveMeta, i18nTitle, i18nEmpty, fireFn])
}

function defaultFire(title: string, body: string): void {
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  new Notification(title, { body, tag: 'smart-contacts-daily' })
}
