/**
 * @file savedFilters.ts
 * Saved-filter presets persisted in meta.saved_filters_v1 as a JSON array.
 * Format-versioned via the key suffix; bump the suffix on any breaking shape change.
 * Rules: no React imports here — pure TypeScript helpers only. No direct DB access.
 */
import type { ContactFilters } from './filterTypes'

export interface SavedFilter {
  id: string
  name: string
  filters: ContactFilters
}

const META_KEY = 'saved_filters_v1'

/** Read presets from a metaSettings dict. */
export function loadSavedFilters(metaSettings: Record<string, string>): SavedFilter[] {
  const raw = metaSettings[META_KEY]
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidPreset)
  } catch {
    return []
  }
}

/** Persist presets via the saveMeta callback (bypasses any local cache mismatch). */
export async function saveSavedFilters(
  saveMeta: (key: string, value: string) => Promise<void>,
  presets: SavedFilter[],
): Promise<void> {
  await saveMeta(META_KEY, JSON.stringify(presets))
}

/** A filter is "non-trivial" if it differs from default in scope, group, tag, or has non-empty search. */
export function isFilterNonTrivial(f: ContactFilters): boolean {
  return f.scope !== 'all' || f.group !== null || f.tag !== null || f.search.trim() !== ''
}

function isValidPreset(p: unknown): p is SavedFilter {
  if (!p || typeof p !== 'object') return false
  const r = p as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return false
  const f = r.filters as Record<string, unknown> | undefined
  if (!f || typeof f !== 'object') return false
  if (typeof f.scope !== 'string') return false
  if (f.group !== null && typeof f.group !== 'string') return false
  if (f.tag !== null && typeof f.tag !== 'string') return false
  if (typeof f.search !== 'string') return false
  return true
}
