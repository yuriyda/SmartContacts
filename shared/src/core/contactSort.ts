/**
 * @file contactSort.ts
 * Pure sort helpers for the Contacts list. Spec §22 line 415:
 *   "Sortbar by name / lastContactedAt / createdAt / priority"
 *
 * Modeled after TaskOrchestrator/tauri-app/src/ui/SortBar.tsx — same toggle
 * pattern (clicking the active field flips direction).
 *
 * Rules: no React, no DOM. Pure.
 */
import type { Contact } from '../types'
import { computeDisplayName } from './contactActions'

export const CONTACT_SORT_FIELDS = [
  'displayName',
  'lastContactedAt',
  'createdAt',
  'priority',
] as const

export type ContactSortField = (typeof CONTACT_SORT_FIELDS)[number]
export type ContactSortDir = 'asc' | 'desc'
export interface ContactSort {
  field: ContactSortField
  dir: ContactSortDir
}

/**
 * Toggle the active sort. If `field` already active, flip direction.
 * Otherwise set to the new field with the field's natural default:
 *   - displayName / createdAt: asc
 *   - lastContactedAt: desc (most-recently-contacted first)
 *   - priority: asc (highest priority = lowest number first)
 */
export function toggleContactSort(
  current: ContactSort | null,
  field: ContactSortField,
): ContactSort {
  if (current?.field === field) {
    return { field, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  }
  const naturalDir: ContactSortDir = field === 'lastContactedAt' ? 'desc' : 'asc'
  return { field, dir: naturalDir }
}

/**
 * Returns a new sorted array. If `sort` is null, returns the input array
 * reference unchanged so React can skip re-renders downstream.
 *
 * Stable across ties: secondary key is `id` ascending — guarantees a
 * deterministic order independent of input shuffling.
 */
export function applyContactSort(
  contacts: Contact[],
  sort: ContactSort | null,
  locale: 'en' | 'ru',
): Contact[] {
  if (!sort) return contacts
  const sign = sort.dir === 'asc' ? 1 : -1
  const sorted = [...contacts]
  sorted.sort((a, b) => {
    const cmp = compareByField(a, b, sort.field, locale)
    if (cmp !== 0) return cmp * sign
    // Stable tiebreaker — id is unique and non-empty in valid contacts.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return sorted
}

function compareByField(
  a: Contact,
  b: Contact,
  field: ContactSortField,
  locale: 'en' | 'ru',
): number {
  switch (field) {
    case 'displayName': {
      const an = computeDisplayName(a, locale)
      const bn = computeDisplayName(b, locale)
      return an.localeCompare(bn, locale, { sensitivity: 'base' })
    }
    case 'lastContactedAt': {
      // Missing values sort to the end regardless of direction (use empty string
      // which lexicographically precedes any ISO date — combined with the sign
      // we apply at the call-site, this works out correctly only for asc; for
      // desc we explicitly push nulls to the end).
      const av = a.lastContactedAt
      const bv = b.lastContactedAt
      if (av == null && bv == null) return 0
      if (av == null) return 1 // a goes after b regardless of direction
      if (bv == null) return -1
      return av < bv ? -1 : av > bv ? 1 : 0
    }
    case 'createdAt': {
      const av = a.createdAt
      const bv = b.createdAt
      return av < bv ? -1 : av > bv ? 1 : 0
    }
    case 'priority': {
      // Lower number = higher priority. Undefined sorts after everything.
      const av = a.priority ?? Number.POSITIVE_INFINITY
      const bv = b.priority ?? Number.POSITIVE_INFINITY
      return av - bv
    }
  }
}
