/**
 * @file relationshipScore.ts
 * Pure helpers for the Network feature: per-contact relationship score (0..100)
 * and field-completeness count.
 *
 * Spec: docs/superpowers/specs/2026-04-29-contacts-app-design.md §15.4
 *
 * Rules:
 *  - No DB access, no side effects, no React imports.
 *  - `now` is passed in for test determinism (no `Date.now()` reads here).
 *  - Decay tunables are local consts; tests assert relative monotonicity, not exact numbers.
 *  - Do NOT import from db/, sync/, or google/ sub-packages — types only.
 */

import type { Contact } from '../types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScoreInput {
  priority?: 1 | 2 | 3 | 4 | 5
  lastContactedAt?: string // ISO; if undefined, recencyScore = 0 (very stale)
  recentInteractionCount: number
  filledFieldCount: number
  now: number // ms epoch
}

// ---------------------------------------------------------------------------
// Internal tunables
// ---------------------------------------------------------------------------

/** Percent-per-day recency decay, indexed by contact priority (1 = highest). */
const DECAY_BY_PRIORITY: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 0.3,
  2: 0.2,
  3: 0.15,
  4: 0.1,
  5: 0.07,
}

/**
 * Number of COUNTED_KEYS considered "fully complete" — used to normalise
 * completeness to 0..100. Must equal COUNTED_KEYS.length.
 */
const FILLED_FIELDS_TARGET = 25

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Compute a 0..100 relationship health score for a single contact.
 *
 * Score composition:
 *   50 % recency    — how recently the contact was reached (decays by priority)
 *   30 % frequency  — recent interaction count, capped at 10 (× 10 = 100)
 *   20 % completeness — fraction of FILLED_FIELDS_TARGET fields present
 */
export function relationshipScore(input: ScoreInput): number {
  const priority = (input.priority ?? 5) as 1 | 2 | 3 | 4 | 5
  const decay = DECAY_BY_PRIORITY[priority]

  let recencyScore = 0
  if (input.lastContactedAt) {
    const lastMs = new Date(input.lastContactedAt).getTime()
    if (Number.isFinite(lastMs)) {
      const days = Math.max(0, (input.now - lastMs) / (1000 * 60 * 60 * 24))
      recencyScore = clamp(100 - days * decay * 10, 0, 100)
      // The "* 10" factor makes the unit "percent per day" at full decay weight.
      // Example for P1 (decay 0.30): 100 - days * 3 → reaches 0 after ~33 days.
      // Example for P5 (decay 0.07): 100 - days * 0.7 → reaches 0 after ~142 days.
    }
  }

  const frequencyScore = clamp(input.recentInteractionCount * 10, 0, 100)
  const completeness = clamp((input.filledFieldCount / FILLED_FIELDS_TARGET) * 100, 0, 100)

  const score = 0.5 * recencyScore + 0.3 * frequencyScore + 0.2 * completeness
  return Math.round(clamp(score, 0, 100))
}

// ---------------------------------------------------------------------------
// countFilledFields
// ---------------------------------------------------------------------------

/**
 * Keys of Contact that are counted towards field completeness.
 * Must contain exactly FILLED_FIELDS_TARGET (25) entries.
 *
 * Excluded intentionally: id, createdAt, updatedAt, deletedAt, lamportTs,
 * deviceId, googleResourceName, googleEtag, googleLastSyncedAt, avatarHash,
 * protected, hidden, socialDetected, honorificPrefix, honorificSuffix,
 * phoneticGiven, phoneticFamily, displayName — these are system/sync fields
 * or derived data, not user-supplied relationship data.
 */
const COUNTED_KEYS: ReadonlyArray<keyof Contact> = [
  'givenName',
  'familyName',
  'middleName',
  'nickname',
  'phones',
  'emails',
  'addresses',
  'events',
  'organizations',
  'urls',
  'imClients',
  'relationsExternal',
  'groups',
  'notesMd',
  'userDefined',
  'locale',
  'gender',
  'occupation',
  'tags',
  'relationsInternal',
  'customFields',
  'lastContactedAt',
  'preferredChannel',
  'priority',
  'reminders',
]
// 25 keys total — matches FILLED_FIELDS_TARGET.

/**
 * Count how many of the 25 tracked Contact fields are non-empty.
 *
 * A field is considered empty when it is:
 *   - undefined or null
 *   - a blank/whitespace-only string
 *   - an empty array ([])
 *   - an empty plain object ({})
 */
export function countFilledFields(c: Contact): number {
  let n = 0
  for (const k of COUNTED_KEYS) {
    const v = (c as unknown as Record<string, unknown>)[k as string]
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    if (
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v as Record<string, unknown>).length === 0
    )
      continue
    n++
  }
  return n
}
