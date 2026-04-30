/**
 * @file networkWidgets.ts
 * Pure helpers for NetworkDashboard widgets. No DB access; no React.
 * Spec §15.5 / §15.4.
 *
 * Rules:
 *  - No side effects, no DB imports, no React imports.
 *  - `now` is passed in for test determinism.
 *  - cap defaults prevent rendering huge lists on initial load.
 */
import type { Contact, ContactTask, Interaction } from '../types'
import { relationshipScore, countFilledFields } from './relationshipScore'

// Re-export Interaction so callers can type the interactionsByContact builder.
export type { Interaction }

// ---------------------------------------------------------------------------
// Stale thresholds
// ---------------------------------------------------------------------------

export const DEFAULT_STALE_THRESHOLDS: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 14,
  2: 30,
  3: 60,
  4: 120,
  5: 365,
}

// ---------------------------------------------------------------------------
// TodayItem
// ---------------------------------------------------------------------------

export interface TodayItem {
  contactId: string
  reason: 'birthday' | 'reminder' | 'task'
  label: string // human readable hint
}

/**
 * Collect contacts with a birthday today, a reminder due today, or an open
 * task due today.
 */
export function computeTodayItems(
  contacts: Contact[],
  tasks: ContactTask[],
  now: Date,
): TodayItem[] {
  const out: TodayItem[] = []
  // Use UTC methods throughout to avoid timezone-shift bugs with date-only ISO strings.
  const todayISO = now.toISOString().slice(0, 10)
  const m = now.getUTCMonth() + 1
  const d = now.getUTCDate()

  for (const c of contacts) {
    if (c.deletedAt) continue

    // Birthday today: month + day match in UTC (year ignored).
    // Event dates are stored as YYYY-MM-DD and parsed as UTC midnight.
    for (const ev of c.events ?? []) {
      if (ev.type !== 'birthday') continue
      const evDate = new Date(ev.date)
      if (
        Number.isFinite(evDate.getTime()) &&
        evDate.getUTCMonth() + 1 === m &&
        evDate.getUTCDate() === d
      ) {
        out.push({ contactId: c.id, reason: 'birthday', label: ev.date })
        break
      }
    }

    // Reminder due today (Reminder.date is a local ISO date "YYYY-MM-DD")
    for (const r of c.reminders ?? []) {
      if (r.date && r.date.slice(0, 10) === todayISO) {
        out.push({ contactId: c.id, reason: 'reminder', label: r.date })
      }
    }
  }

  // Open tasks due today
  for (const t of tasks) {
    if (t.deletedAt || t.doneAt) continue
    if (t.dueAt && t.dueAt.slice(0, 10) === todayISO) {
      const c = contacts.find((x) => x.id === t.contactId)
      if (!c || c.deletedAt) continue
      out.push({ contactId: t.contactId, reason: 'task', label: t.text.slice(0, 60) })
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// StaleItem
// ---------------------------------------------------------------------------

export interface StaleItem {
  contact: Contact
  daysOverdue: number // days past threshold for that priority
}

/**
 * Return contacts whose last-contacted date exceeds the stale threshold for
 * their priority, sorted by daysOverdue DESC and capped at `cap`.
 *
 * Contacts with no lastContactedAt are skipped (never contacted — a separate
 * "never reached out" category).
 */
export function computeStaleItems(
  contacts: Contact[],
  thresholds: Record<1 | 2 | 3 | 4 | 5, number>,
  now: Date,
  cap = 20,
): StaleItem[] {
  const items: StaleItem[] = []
  const nowMs = now.getTime()

  for (const c of contacts) {
    if (c.deletedAt) continue
    if (!c.lastContactedAt) continue // never contacted: skipped
    const lastMs = new Date(c.lastContactedAt).getTime()
    if (!Number.isFinite(lastMs)) continue
    const days = (nowMs - lastMs) / 86400000
    const p = (c.priority ?? 5) as 1 | 2 | 3 | 4 | 5
    const threshold = thresholds[p]
    if (days > threshold) {
      items.push({ contact: c, daysOverdue: Math.floor(days - threshold) })
    }
  }

  items.sort((a, b) => b.daysOverdue - a.daysOverdue)
  return items.slice(0, cap)
}

// ---------------------------------------------------------------------------
// WeakeningItem
// ---------------------------------------------------------------------------

export interface WeakeningItem {
  contact: Contact
  score: number // 0..100
}

/**
 * Return contacts with a relationship score < 50, sorted ASC (weakest first),
 * capped at `cap`.
 *
 * `interactionsByContact` maps contactId → count of recent (last 90d) alive
 * interactions. The caller pre-aggregates this from the interaction list to
 * keep this helper a pure function.
 */
export function computeWeakeningItems(
  contacts: Contact[],
  interactionsByContact: Map<string, number>, // contactId → recent interaction count (last 90d)
  now: Date,
  cap = 20,
): WeakeningItem[] {
  const items: WeakeningItem[] = []

  for (const c of contacts) {
    if (c.deletedAt) continue
    const recent = interactionsByContact.get(c.id) ?? 0
    const filled = countFilledFields(c)
    const lastContactedAt = c.lastContactedAt ?? undefined
    const score = relationshipScore({
      priority: (c.priority ?? 5) as 1 | 2 | 3 | 4 | 5,
      ...(lastContactedAt !== undefined ? { lastContactedAt } : {}),
      recentInteractionCount: recent,
      filledFieldCount: filled,
      now: now.getTime(),
    })
    if (score < 50) items.push({ contact: c, score })
  }

  items.sort((a, b) => a.score - b.score)
  return items.slice(0, cap)
}

// ---------------------------------------------------------------------------
// UpcomingItem
// ---------------------------------------------------------------------------

export interface UpcomingItem {
  task: ContactTask
  daysUntilDue: number // 1..7
}

/**
 * Tasks due in (today + 1 day, today + 7 days], alive, open. Sorted by dueAt ASC.
 * Tasks due today are excluded (handled by Today widget).
 *
 * All date comparisons are UTC-based to avoid local-timezone shifts when
 * dueAt is stored as a YYYY-MM-DD string (parsed as UTC midnight).
 */
export function computeUpcomingItems(
  tasks: ContactTask[],
  contacts: Contact[],
  now: Date,
  cap = 20,
): UpcomingItem[] {
  const items: UpcomingItem[] = []
  // UTC midnight for today
  const todayMs = utcStartOfDay(now).getTime()
  const cutoffMs = todayMs + 7 * 86400000
  const aliveIds = new Set(contacts.filter((c) => !c.deletedAt).map((c) => c.id))
  for (const t of tasks) {
    if (t.deletedAt || t.doneAt) continue
    if (!t.dueAt) continue
    if (!aliveIds.has(t.contactId)) continue
    // Parse YYYY-MM-DD as UTC midnight to match storage convention.
    const due = new Date(t.dueAt.slice(0, 10) + 'T00:00:00.000Z').getTime()
    if (!Number.isFinite(due)) continue
    if (due > todayMs && due <= cutoffMs) {
      items.push({ task: t, daysUntilDue: Math.round((due - todayMs) / 86400000) })
    }
  }
  items.sort((a, b) => a.task.dueAt!.localeCompare(b.task.dueAt!))
  return items.slice(0, cap)
}

// ---------------------------------------------------------------------------
// OpenTaskItem
// ---------------------------------------------------------------------------

export interface OpenTaskItem {
  task: ContactTask
}

/**
 * All alive open tasks, sorted by priority ASC NULLS LAST, then dueAt ASC NULLS LAST.
 * Tasks for hidden/deleted contacts are excluded.
 */
export function computeOpenTaskItems(
  tasks: ContactTask[],
  contacts: Contact[],
  cap = 20,
): OpenTaskItem[] {
  const aliveIds = new Set(contacts.filter((c) => !c.deletedAt).map((c) => c.id))
  const filtered = tasks
    .filter((t) => !t.deletedAt && !t.doneAt && aliveIds.has(t.contactId))
    .sort((a, b) => {
      const pa = a.priority ?? 6
      const pb = b.priority ?? 6
      if (pa !== pb) return pa - pb
      const da = a.dueAt ?? '\uffff'
      const db = b.dueAt ?? '\uffff'
      return da.localeCompare(db)
    })
    .slice(0, cap)
  return filtered.map((task) => ({ task }))
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** UTC midnight for the given date — avoids local-timezone offset issues. */
function utcStartOfDay(d: Date): Date {
  return new Date(d.toISOString().slice(0, 10) + 'T00:00:00.000Z')
}
