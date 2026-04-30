/**
 * @file networkNotifications.ts
 * Pure helpers for the in-page notification scheduler.
 * Spec §15.6.
 *
 * Rules:
 *  - No DOM, no Notification API references — those live in the web layer.
 *  - This module computes WHAT to notify; the web layer decides WHEN/HOW.
 *  - All inputs explicit (now, lastFiredISO, etc.) for test determinism.
 */
import type { Contact } from '../types'
import { computeTodayItems, type TodayItem } from './networkWidgets'

// Re-export so callers don't need a second import.
export { computeTodayItems, type TodayItem }

export interface NotificationContent {
  title: string
  body: string // multi-line summary
  itemsTotal: number
}

/** Build the consolidated message body. Returns null if nothing to notify. */
export function buildDailySummary(
  items: TodayItem[],
  contactsById: Map<string, Contact>,
  i18nTitle: string,
  i18nEmpty: string,
): NotificationContent | null {
  if (items.length === 0) return null
  const grouped = { birthday: 0, reminder: 0, task: 0 }
  for (const it of items) grouped[it.reason]++

  const lines: string[] = []
  if (grouped.birthday > 0) lines.push(`🎂 ${grouped.birthday}`)
  if (grouped.reminder > 0) lines.push(`🔔 ${grouped.reminder}`)
  if (grouped.task > 0) lines.push(`📋 ${grouped.task}`)

  // First 3 contact names
  const names = items
    .slice(0, 3)
    .map((it) => contactsById.get(it.contactId)?.displayName ?? '')
    .filter((n) => n.trim() !== '')

  return {
    title: i18nTitle,
    body: [...lines, ...names].join(' · ') || i18nEmpty,
    itemsTotal: items.length,
  }
}

/**
 * Compute the next firing time given a desired hour (0..23, local) and a baseline now.
 * Returns ms epoch.
 */
export function nextFireMs(now: Date, hour: number): number {
  const target = new Date(now)
  target.setHours(hour, 0, 0, 0)
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }
  return target.getTime()
}

/**
 * Should we fire now? Returns true if last_fired_v1 is on a previous calendar day
 * (compared to `now`) or is missing entirely.
 */
export function shouldFireNow(now: Date, lastFiredISO: string | undefined): boolean {
  if (!lastFiredISO) return true
  const last = new Date(lastFiredISO)
  if (!Number.isFinite(last.getTime())) return true
  return last.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10)
}
