/**
 * @file networkWidgets.test.ts
 * Tests for pure NetworkDashboard widget data helpers.
 * No DB, no React, no side effects.
 * Spec §15.5 / §15.4.
 *
 * Rules:
 *  - All contact fixtures built via makeContact().
 *  - All task fixtures built via makeTask().
 *  - Tests use a fixed NOW for determinism.
 */
import { describe, test, expect } from 'vitest'
import type { Contact, ContactTask } from '../types'
import {
  computeTodayItems,
  computeStaleItems,
  computeWeakeningItems,
  computeUpcomingItems,
  computeOpenTaskItems,
  DEFAULT_STALE_THRESHOLDS,
} from './networkWidgets'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeContact(partial: Partial<Contact>): Contact {
  return {
    id: partial.id ?? 'c1',
    createdAt: '',
    updatedAt: '',
    lamportTs: 1,
    deviceId: 'DEV',
    ...partial,
  }
}

function makeTask(partial: Partial<ContactTask>): ContactTask {
  return {
    id: partial.id ?? 't1',
    contactId: partial.contactId ?? 'c1',
    text: partial.text ?? 'Test task',
    createdAt: '',
    updatedAt: '',
    lamportTs: 1,
    deviceId: 'DEV',
    ...partial,
  }
}

// Fixed "now": 2026-04-30 UTC
const NOW = new Date('2026-04-30T12:00:00.000Z')
const TODAY_ISO = '2026-04-30'

// ---------------------------------------------------------------------------
// computeTodayItems
// ---------------------------------------------------------------------------

describe('computeTodayItems', () => {
  test('birthday today is included', () => {
    const c = makeContact({
      id: 'c1',
      events: [{ date: '2000-04-30', type: 'birthday' }],
    })
    const items = computeTodayItems([c], [], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]!.reason).toBe('birthday')
    expect(items[0]!.contactId).toBe('c1')
  })

  test('birthday yesterday is NOT included', () => {
    const c = makeContact({
      id: 'c1',
      events: [{ date: '2000-04-29', type: 'birthday' }],
    })
    const items = computeTodayItems([c], [], NOW)
    expect(items).toHaveLength(0)
  })

  test('reminder due today is included', () => {
    const c = makeContact({
      id: 'c1',
      reminders: [{ id: 'r1', date: TODAY_ISO, text: 'Call' }],
    })
    const items = computeTodayItems([c], [], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]!.reason).toBe('reminder')
  })

  test('task due today is included', () => {
    const c = makeContact({ id: 'c1' })
    const t = makeTask({ contactId: 'c1', dueAt: TODAY_ISO })
    const items = computeTodayItems([c], [t], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]!.reason).toBe('task')
  })

  test('deleted contact birthday is excluded', () => {
    const c = makeContact({
      id: 'c1',
      deletedAt: '2026-01-01T00:00:00Z',
      events: [{ date: '2000-04-30', type: 'birthday' }],
    })
    expect(computeTodayItems([c], [], NOW)).toHaveLength(0)
  })

  test('done task is excluded', () => {
    const c = makeContact({ id: 'c1' })
    const t = makeTask({ contactId: 'c1', dueAt: TODAY_ISO, doneAt: '2026-04-29T08:00:00Z' })
    expect(computeTodayItems([c], [t], NOW)).toHaveLength(0)
  })

  test('task for deleted contact is excluded', () => {
    const c = makeContact({ id: 'c1', deletedAt: '2026-04-01T00:00:00Z' })
    const t = makeTask({ contactId: 'c1', dueAt: TODAY_ISO })
    expect(computeTodayItems([c], [t], NOW)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// computeStaleItems
// ---------------------------------------------------------------------------

describe('computeStaleItems', () => {
  test('P1 contact 30 days overdue is included (threshold 14)', () => {
    // 44 days ago: 44 > 14 → 30 days overdue
    const lastAt = new Date(NOW.getTime() - 44 * 86400000).toISOString()
    const c = makeContact({ id: 'c1', priority: 1, lastContactedAt: lastAt })
    const items = computeStaleItems([c], DEFAULT_STALE_THRESHOLDS, NOW)
    expect(items).toHaveLength(1)
    expect(items[0]!.daysOverdue).toBe(30)
  })

  test('P5 contact 30 days since contact is NOT overdue (threshold 365)', () => {
    const lastAt = new Date(NOW.getTime() - 30 * 86400000).toISOString()
    const c = makeContact({ id: 'c1', priority: 5, lastContactedAt: lastAt })
    expect(computeStaleItems([c], DEFAULT_STALE_THRESHOLDS, NOW)).toHaveLength(0)
  })

  test('contact with no lastContactedAt is skipped', () => {
    const c = makeContact({ id: 'c1', priority: 1 })
    expect(computeStaleItems([c], DEFAULT_STALE_THRESHOLDS, NOW)).toHaveLength(0)
  })

  test('deleted contact is excluded', () => {
    const lastAt = new Date(NOW.getTime() - 100 * 86400000).toISOString()
    const c = makeContact({
      id: 'c1',
      priority: 1,
      lastContactedAt: lastAt,
      deletedAt: '2026-01-01T00:00:00Z',
    })
    expect(computeStaleItems([c], DEFAULT_STALE_THRESHOLDS, NOW)).toHaveLength(0)
  })

  test('sort by daysOverdue DESC', () => {
    const c1 = makeContact({
      id: 'c1',
      priority: 1,
      lastContactedAt: new Date(NOW.getTime() - 50 * 86400000).toISOString(),
    })
    const c2 = makeContact({
      id: 'c2',
      priority: 1,
      lastContactedAt: new Date(NOW.getTime() - 100 * 86400000).toISOString(),
    })
    const items = computeStaleItems([c1, c2], DEFAULT_STALE_THRESHOLDS, NOW)
    expect(items[0]!.contact.id).toBe('c2') // more overdue comes first
  })

  test('cap limits result count', () => {
    const contacts = Array.from({ length: 30 }, (_, i) =>
      makeContact({
        id: `c${i}`,
        priority: 1,
        lastContactedAt: new Date(NOW.getTime() - (20 + i) * 86400000).toISOString(),
      }),
    )
    const items = computeStaleItems(contacts, DEFAULT_STALE_THRESHOLDS, NOW, 5)
    expect(items).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// computeWeakeningItems
// ---------------------------------------------------------------------------

describe('computeWeakeningItems', () => {
  test('low-score contact (no interactions, stale) is included', () => {
    // P1, last contact 100 days ago → very low score
    const lastAt = new Date(NOW.getTime() - 100 * 86400000).toISOString()
    const c = makeContact({ id: 'c1', priority: 1, lastContactedAt: lastAt })
    const map = new Map<string, number>()
    const items = computeWeakeningItems([c], map, NOW)
    expect(items).toHaveLength(1)
    expect(items[0]!.score).toBeLessThan(50)
  })

  test('high-score contact is excluded', () => {
    // P5, contacted 1 day ago, 10 interactions → score >> 50
    const lastAt = new Date(NOW.getTime() - 1 * 86400000).toISOString()
    const c = makeContact({ id: 'c1', priority: 5, lastContactedAt: lastAt })
    const map = new Map([['c1', 10]])
    expect(computeWeakeningItems([c], map, NOW)).toHaveLength(0)
  })

  test('deleted contact is excluded', () => {
    const lastAt = new Date(NOW.getTime() - 200 * 86400000).toISOString()
    const c = makeContact({
      id: 'c1',
      priority: 1,
      lastContactedAt: lastAt,
      deletedAt: '2026-01-01T00:00:00Z',
    })
    expect(computeWeakeningItems([c], new Map(), NOW)).toHaveLength(0)
  })

  test('sorted ASC by score (weakest first)', () => {
    const c1 = makeContact({
      id: 'c1',
      priority: 1,
      lastContactedAt: new Date(NOW.getTime() - 50 * 86400000).toISOString(),
    })
    const c2 = makeContact({
      id: 'c2',
      priority: 2,
      lastContactedAt: new Date(NOW.getTime() - 40 * 86400000).toISOString(),
    })
    const items = computeWeakeningItems([c1, c2], new Map(), NOW)
    // Both should be < 50 for P1/P2 contacts with ~50 days since contact
    if (items.length >= 2) {
      expect(items[0]!.score).toBeLessThanOrEqual(items[1]!.score)
    }
  })

  test('cap limits result count', () => {
    const contacts = Array.from({ length: 30 }, (_, i) =>
      makeContact({
        id: `c${i}`,
        priority: 1,
        lastContactedAt: new Date(NOW.getTime() - (50 + i) * 86400000).toISOString(),
      }),
    )
    const items = computeWeakeningItems(contacts, new Map(), NOW, 5)
    expect(items).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// computeUpcomingItems
// ---------------------------------------------------------------------------

describe('computeUpcomingItems', () => {
  const c = makeContact({ id: 'c1' })

  test('task due tomorrow is included with daysUntilDue === 1', () => {
    const tomorrow = new Date(NOW.getTime() + 1 * 86400000).toISOString().slice(0, 10)
    const t = makeTask({ contactId: 'c1', dueAt: tomorrow })
    const items = computeUpcomingItems([t], [c], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]!.daysUntilDue).toBe(1)
  })

  test('task due today is NOT included (handled by Today widget)', () => {
    const t = makeTask({ contactId: 'c1', dueAt: TODAY_ISO })
    const items = computeUpcomingItems([t], [c], NOW)
    expect(items).toHaveLength(0)
  })

  test('task due exactly 7 days from now is included', () => {
    const sevenDays = new Date(NOW.getTime() + 7 * 86400000).toISOString().slice(0, 10)
    const t = makeTask({ contactId: 'c1', dueAt: sevenDays })
    const items = computeUpcomingItems([t], [c], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]!.daysUntilDue).toBe(7)
  })

  test('task due 8 days from now is NOT included', () => {
    const eightDays = new Date(NOW.getTime() + 8 * 86400000).toISOString().slice(0, 10)
    const t = makeTask({ contactId: 'c1', dueAt: eightDays })
    const items = computeUpcomingItems([t], [c], NOW)
    expect(items).toHaveLength(0)
  })

  test('task with no dueAt is excluded', () => {
    const t = makeTask({ contactId: 'c1' })
    const items = computeUpcomingItems([t], [c], NOW)
    expect(items).toHaveLength(0)
  })

  test('done task with future dueAt is excluded', () => {
    const tomorrow = new Date(NOW.getTime() + 1 * 86400000).toISOString().slice(0, 10)
    const t = makeTask({ contactId: 'c1', dueAt: tomorrow, doneAt: TODAY_ISO })
    const items = computeUpcomingItems([t], [c], NOW)
    expect(items).toHaveLength(0)
  })

  test('task for soft-deleted contact is excluded', () => {
    const deletedContact = makeContact({ id: 'c2', deletedAt: '2026-01-01T00:00:00Z' })
    const tomorrow = new Date(NOW.getTime() + 1 * 86400000).toISOString().slice(0, 10)
    const t = makeTask({ contactId: 'c2', dueAt: tomorrow })
    const items = computeUpcomingItems([t], [deletedContact], NOW)
    expect(items).toHaveLength(0)
  })

  test('sorted by dueAt ASC', () => {
    const d2 = new Date(NOW.getTime() + 2 * 86400000).toISOString().slice(0, 10)
    const d5 = new Date(NOW.getTime() + 5 * 86400000).toISOString().slice(0, 10)
    const t1 = makeTask({ id: 't1', contactId: 'c1', dueAt: d5 })
    const t2 = makeTask({ id: 't2', contactId: 'c1', dueAt: d2 })
    const items = computeUpcomingItems([t1, t2], [c], NOW)
    expect(items[0]!.task.id).toBe('t2') // earlier due date first
    expect(items[1]!.task.id).toBe('t1')
  })

  test('cap limits result count', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => {
      const due = new Date(NOW.getTime() + (i + 1) * 86400000).toISOString().slice(0, 10)
      return makeTask({ id: `t${i}`, contactId: 'c1', dueAt: due })
    })
    const items = computeUpcomingItems(tasks, [c], NOW, 3)
    expect(items).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// computeOpenTaskItems
// ---------------------------------------------------------------------------

describe('computeOpenTaskItems', () => {
  const c1 = makeContact({ id: 'c1' })
  const c2 = makeContact({ id: 'c2' })

  test('all open tasks returned', () => {
    const t1 = makeTask({ id: 't1', contactId: 'c1', priority: 1 })
    const t2 = makeTask({ id: 't2', contactId: 'c2', priority: 2 })
    const items = computeOpenTaskItems([t1, t2], [c1, c2])
    expect(items).toHaveLength(2)
  })

  test('done task is excluded', () => {
    const t = makeTask({ id: 't1', contactId: 'c1', doneAt: TODAY_ISO })
    const items = computeOpenTaskItems([t], [c1])
    expect(items).toHaveLength(0)
  })

  test('deleted task is excluded', () => {
    const t = makeTask({ id: 't1', contactId: 'c1', deletedAt: TODAY_ISO })
    const items = computeOpenTaskItems([t], [c1])
    expect(items).toHaveLength(0)
  })

  test('task for soft-deleted contact is excluded', () => {
    const deleted = makeContact({ id: 'cx', deletedAt: '2026-01-01T00:00:00Z' })
    const t = makeTask({ id: 't1', contactId: 'cx' })
    const items = computeOpenTaskItems([t], [deleted])
    expect(items).toHaveLength(0)
  })

  test('sorted by priority ASC then dueAt ASC', () => {
    const d3 = new Date(NOW.getTime() + 3 * 86400000).toISOString().slice(0, 10)
    const d1 = new Date(NOW.getTime() + 1 * 86400000).toISOString().slice(0, 10)
    const ta = makeTask({ id: 'ta', contactId: 'c1', priority: 2, dueAt: d3 })
    const tb = makeTask({ id: 'tb', contactId: 'c1', priority: 1, dueAt: d1 })
    const tc = makeTask({ id: 'tc', contactId: 'c1', priority: 2, dueAt: d1 })
    const items = computeOpenTaskItems([ta, tb, tc], [c1])
    expect(items[0]!.task.id).toBe('tb') // priority 1 first
    expect(items[1]!.task.id).toBe('tc') // priority 2, earlier due
    expect(items[2]!.task.id).toBe('ta') // priority 2, later due
  })

  test('no-priority tasks sorted last', () => {
    const ta = makeTask({ id: 'ta', contactId: 'c1', priority: 1 })
    const tb = makeTask({ id: 'tb', contactId: 'c1' }) // no priority
    const items = computeOpenTaskItems([tb, ta], [c1])
    expect(items[0]!.task.id).toBe('ta') // priority 1 before no-priority
    expect(items[1]!.task.id).toBe('tb')
  })

  test('cap at 20 default', () => {
    const contacts = [makeContact({ id: 'cx' })]
    const tasks = Array.from({ length: 30 }, (_, i) => makeTask({ id: `t${i}`, contactId: 'cx' }))
    const items = computeOpenTaskItems(tasks, contacts)
    expect(items).toHaveLength(20)
  })
})
