/**
 * @file networkSettings.ts
 * Pure helpers to read/write Network feature meta keys with safe defaults.
 * Rules: no React imports; no DB access (caller hands metaSettings record + saveMeta).
 */
import { DEFAULT_STALE_THRESHOLDS } from '@smart-contacts/shared'

export type StaleThresholds = Record<1 | 2 | 3 | 4 | 5, number>

export function readStaleThresholds(meta: Record<string, string>): StaleThresholds {
  const raw = meta['stale_thresholds_v1']
  if (!raw) return { ...DEFAULT_STALE_THRESHOLDS }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out = { ...DEFAULT_STALE_THRESHOLDS }
    for (const k of [1, 2, 3, 4, 5] as const) {
      const v = parsed[String(k)]
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.floor(v)
    }
    return out
  } catch {
    return { ...DEFAULT_STALE_THRESHOLDS }
  }
}

export function readMyCity(meta: Record<string, string>): string {
  return meta['my_city_v1'] ?? ''
}

export function readShowScore(meta: Record<string, string>): boolean {
  return meta['show_score_v1'] === '1'
}
