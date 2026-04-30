// Tests for date.ts — date utility helpers.
// Run under default jsdom environment (no wa-sqlite, no IndexedDB needed).

import { describe, test, expect } from 'vitest'
import { localIsoDate, fmtDate, relIsoDate, isBirthdayThisMonth, timeAgo } from './date'

describe('localIsoDate', () => {
  test('produces deterministic YYYY-MM-DD for a fixed Date', () => {
    const d = new Date(2026, 3, 29) // April 29, 2026 (local)
    expect(localIsoDate(d)).toBe('2026-04-29')
  })

  test('zero-pads month and day', () => {
    const d = new Date(2026, 0, 5) // Jan 5
    expect(localIsoDate(d)).toBe('2026-01-05')
  })
})

describe('fmtDate', () => {
  test('DD.MM.YYYY', () => {
    expect(fmtDate('2026-04-29', 'DD.MM.YYYY', 'en')).toBe('29.04.2026')
  })

  test('YYYY-MM-DD returns input unchanged', () => {
    expect(fmtDate('2026-04-29', 'YYYY-MM-DD', 'en')).toBe('2026-04-29')
  })

  test('MM/DD/YYYY', () => {
    expect(fmtDate('2026-04-29', 'MM/DD/YYYY', 'en')).toBe('04/29/2026')
  })

  test('locale ru does not change digit-only output', () => {
    expect(fmtDate('2026-04-29', 'DD.MM.YYYY', 'ru')).toBe('29.04.2026')
  })
})

describe('relIsoDate', () => {
  test('-1 from 2026-04-29 returns 2026-04-28', () => {
    const now = new Date('2026-04-29T12:00:00')
    expect(relIsoDate(-1, now)).toBe('2026-04-28')
  })

  test('+0 returns today', () => {
    const now = new Date('2026-04-29T12:00:00')
    expect(relIsoDate(0, now)).toBe('2026-04-29')
  })

  test('+1 returns tomorrow', () => {
    const now = new Date('2026-04-29T12:00:00')
    expect(relIsoDate(1, now)).toBe('2026-04-30')
  })
})

describe('isBirthdayThisMonth', () => {
  test('same month returns true', () => {
    expect(isBirthdayThisMonth('1985-04-15', new Date('2026-04-29T12:00:00'))).toBe(true)
  })

  test('different month returns false', () => {
    expect(isBirthdayThisMonth('1985-03-15', new Date('2026-04-29T12:00:00'))).toBe(false)
  })

  test('month boundary — last day of month is still same month', () => {
    expect(isBirthdayThisMonth('1990-04-30', new Date('2026-04-01T00:00:00'))).toBe(true)
  })
})

describe('timeAgo', () => {
  test('null → "—"', () => {
    expect(timeAgo(null, 'en')).toBe('—')
  })

  test('undefined → "—"', () => {
    expect(timeAgo(undefined, 'ru')).toBe('—')
  })

  test('0 seconds → "just now"', () => {
    const now = new Date('2026-04-29T12:00:00Z')
    expect(timeAgo('2026-04-29T12:00:00Z', 'en', now)).toBe('just now')
  })

  test('0 seconds → "только что" (ru)', () => {
    const now = new Date('2026-04-29T12:00:00Z')
    expect(timeAgo('2026-04-29T12:00:00Z', 'ru', now)).toBe('только что')
  })

  test('5 minutes back → "5m ago"', () => {
    const now = new Date('2026-04-29T12:05:00Z')
    expect(timeAgo('2026-04-29T12:00:00Z', 'en', now)).toBe('5m ago')
  })

  test('5 minutes back → "5 мин назад"', () => {
    const now = new Date('2026-04-29T12:05:00Z')
    expect(timeAgo('2026-04-29T12:00:00Z', 'ru', now)).toBe('5 мин назад')
  })

  test('2 days back → "2d ago"', () => {
    const now = new Date('2026-05-01T12:00:00Z')
    expect(timeAgo('2026-04-29T12:00:00Z', 'en', now)).toBe('2d ago')
  })

  test('2 days back → "2 дн назад"', () => {
    const now = new Date('2026-05-01T12:00:00Z')
    expect(timeAgo('2026-04-29T12:00:00Z', 'ru', now)).toBe('2 дн назад')
  })

  test('2 hours back → "2h ago"', () => {
    const now = new Date('2026-04-29T14:00:00Z')
    expect(timeAgo('2026-04-29T12:00:00Z', 'en', now)).toBe('2h ago')
  })

  test('35 days back → "1mo ago"', () => {
    const now = new Date('2026-06-03T12:00:00Z')
    expect(timeAgo('2026-04-29T12:00:00Z', 'en', now)).toBe('1mo ago')
  })
})
