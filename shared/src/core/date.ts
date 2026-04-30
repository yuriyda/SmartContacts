// Date utility helpers for Smart Contacts.
// Pure functions — no side effects, no DB access. Safe to import in any layer.
// All date arithmetic uses local time via getFullYear/getMonth/getDate to avoid
// UTC-shift artifacts (do NOT use toISOString() for calendar dates).
// locale parameter is reserved for future long-format (e.g. "Apr 29") rendering;
// current implementations use digits only.

/** Local-TZ ISO date "YYYY-MM-DD" for a Date instance. */
export function localIsoDate(d: Date): string {
  const y = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

/** Format ISO date "YYYY-MM-DD" per chosen format and locale. */
export function fmtDate(
  iso: string,
  fmt: 'DD.MM.YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY',
  locale: 'en' | 'ru',
): string {
  // locale currently unused — reserved for future long-format rendering
  void locale
  const parts = iso.split('-')
  const y = parts[0] ?? ''
  const m = parts[1] ?? ''
  const d = parts[2] ?? ''
  if (fmt === 'DD.MM.YYYY') return `${d}.${m}.${y}`
  if (fmt === 'MM/DD/YYYY') return `${m}/${d}/${y}`
  // 'YYYY-MM-DD' — return as-is
  return iso
}

/** ISO date for `today + offsetDays`. Optional `now` for tests. */
export function relIsoDate(offsetDays: number, now?: Date): string {
  const base = now ? new Date(now) : new Date()
  base.setDate(base.getDate() + offsetDays)
  return localIsoDate(base)
}

/** True if `eventDate` (ISO YYYY-MM-DD) is in the same calendar month as `today`. */
export function isBirthdayThisMonth(eventDate: string, today?: Date): boolean {
  const ref = today ?? new Date()
  const eventMonth = Number(eventDate.split('-')[1])
  return eventMonth === ref.getMonth() + 1
}

/** Humanised "X ago" — "5m ago" / "2h ago" / "3d ago" / "—" for null. Supports en/ru. */
export function timeAgo(iso: string | null | undefined, locale: 'en' | 'ru', now?: Date): string {
  if (iso == null || iso === '') return '—'
  const base = now ?? new Date()
  const then = new Date(iso)
  const diffMs = base.getTime() - then.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const ru = locale === 'ru'

  if (diffSec < 60) return ru ? 'только что' : 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return ru ? `${diffMin} мин назад` : `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return ru ? `${diffHr} ч назад` : `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return ru ? `${diffDay} дн назад` : `${diffDay}d ago`
  const diffMo = Math.floor(diffDay / 30)
  return ru ? `${diffMo} мес назад` : `${diffMo}mo ago`
}
