/**
 * @file networkNotifications.test.ts
 * Tests for pure notification scheduling helpers.
 * No DOM, no Notification API, no React.
 * Spec §15.6.
 *
 * Rules:
 *  - All contact fixtures built inline.
 *  - All dates explicit for determinism.
 */
import { describe, test, expect } from 'vitest'
import type { Contact } from '../types'
import type { TodayItem } from './networkWidgets'
import { buildDailySummary, nextFireMs, shouldFireNow } from './networkNotifications'

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

function makeItem(contactId: string, reason: TodayItem['reason']): TodayItem {
  return { contactId, reason, label: reason }
}

// ---------------------------------------------------------------------------
// buildDailySummary
// ---------------------------------------------------------------------------

describe('buildDailySummary', () => {
  const I18N_TITLE = 'Smart Contacts — today'
  const I18N_EMPTY = 'No items today'

  test('empty items → null', () => {
    expect(buildDailySummary([], new Map(), I18N_TITLE, I18N_EMPTY)).toBeNull()
  })

  test('3 birthdays → title set + body contains 🎂 3', () => {
    const items: TodayItem[] = [
      makeItem('c1', 'birthday'),
      makeItem('c2', 'birthday'),
      makeItem('c3', 'birthday'),
    ]
    const contacts = new Map([
      ['c1', makeContact({ id: 'c1', displayName: 'Alice' })],
      ['c2', makeContact({ id: 'c2', displayName: 'Bob' })],
      ['c3', makeContact({ id: 'c3', displayName: 'Carol' })],
    ])
    const result = buildDailySummary(items, contacts, I18N_TITLE, I18N_EMPTY)
    expect(result).not.toBeNull()
    expect(result!.title).toBe(I18N_TITLE)
    expect(result!.body).toContain('🎂 3')
    expect(result!.itemsTotal).toBe(3)
  })

  test('mixed 1 birthday + 2 tasks → both icons in body', () => {
    const items: TodayItem[] = [
      makeItem('c1', 'birthday'),
      makeItem('c2', 'task'),
      makeItem('c3', 'task'),
    ]
    const contacts = new Map<string, Contact>()
    const result = buildDailySummary(items, contacts, I18N_TITLE, I18N_EMPTY)
    expect(result).not.toBeNull()
    expect(result!.body).toContain('🎂 1')
    expect(result!.body).toContain('📋 2')
    expect(result!.body).not.toContain('🔔')
  })

  test('first 3 contact names appended; 4th not included', () => {
    const items: TodayItem[] = [
      makeItem('c1', 'birthday'),
      makeItem('c2', 'birthday'),
      makeItem('c3', 'birthday'),
      makeItem('c4', 'birthday'),
    ]
    const contacts = new Map([
      ['c1', makeContact({ id: 'c1', displayName: 'Alice' })],
      ['c2', makeContact({ id: 'c2', displayName: 'Bob' })],
      ['c3', makeContact({ id: 'c3', displayName: 'Carol' })],
      ['c4', makeContact({ id: 'c4', displayName: 'Dave' })],
    ])
    const result = buildDailySummary(items, contacts, I18N_TITLE, I18N_EMPTY)
    expect(result).not.toBeNull()
    expect(result!.body).toContain('Alice')
    expect(result!.body).toContain('Bob')
    expect(result!.body).toContain('Carol')
    expect(result!.body).not.toContain('Dave')
  })
})

// ---------------------------------------------------------------------------
// nextFireMs
// ---------------------------------------------------------------------------

describe('nextFireMs', () => {
  test('now is 8:00, hour=9 → returns 9:00 today', () => {
    const now = new Date('2024-05-10T08:00:00')
    const result = nextFireMs(now, 9)
    const expected = new Date('2024-05-10T09:00:00')
    expect(result).toBe(expected.getTime())
  })

  test('now is 10:00, hour=9 → returns 9:00 tomorrow', () => {
    const now = new Date('2024-05-10T10:00:00')
    const result = nextFireMs(now, 9)
    const expected = new Date('2024-05-11T09:00:00')
    expect(result).toBe(expected.getTime())
  })

  test('now is exactly 9:00, hour=9 → returns 9:00 tomorrow (not today)', () => {
    const now = new Date('2024-05-10T09:00:00')
    const result = nextFireMs(now, 9)
    const expected = new Date('2024-05-11T09:00:00')
    expect(result).toBe(expected.getTime())
  })
})

// ---------------------------------------------------------------------------
// shouldFireNow
// ---------------------------------------------------------------------------

describe('shouldFireNow', () => {
  const TODAY = new Date('2024-05-10T10:00:00Z')

  test('undefined lastFiredISO → true', () => {
    expect(shouldFireNow(TODAY, undefined)).toBe(true)
  })

  test('empty string → true', () => {
    expect(shouldFireNow(TODAY, '')).toBe(true)
  })

  test('last fired yesterday → true', () => {
    expect(shouldFireNow(TODAY, '2024-05-09T08:00:00.000Z')).toBe(true)
  })

  test('last fired today → false', () => {
    expect(shouldFireNow(TODAY, '2024-05-10T08:00:00.000Z')).toBe(false)
  })

  test('last fired in the future → false (same ISO day)', () => {
    expect(shouldFireNow(TODAY, '2024-05-10T23:59:00.000Z')).toBe(false)
  })
})
