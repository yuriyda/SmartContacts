// Contact domain action helpers for Smart Contacts.
// Contains: Lamport clock bumping, bidirectional relation mirroring,
// custom field validation, display name computation, and changed-field counting.
//
// Rules:
//  - bumpLamport is the ONLY function here that touches the DB.
//  - All other exports are pure functions.
//  - Do NOT add business logic that belongs to sync (sync.ts).
//  - Do NOT import from UI layers.

import type { DbAdapter } from '../db/adapter'
import type { Contact, InternalRelation, Ulid } from '../types'

/**
 * Bump local lamport_ts atomically and return the new value.
 * Reads `vector_clock.counter` for `deviceId`, increments by 1, writes back.
 * Caller is expected to use the returned number on the same row's update.
 */
export async function bumpLamport(db: DbAdapter, deviceId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx.select<{ counter: number }>(
      'SELECT counter FROM vector_clock WHERE device_id = ?',
      [deviceId],
    )
    const next = (rows[0]?.counter ?? 0) + 1
    await tx.execute(
      `INSERT INTO vector_clock (device_id, counter) VALUES (?, ?)
       ON CONFLICT(device_id) DO UPDATE SET counter = excluded.counter`,
      [deviceId, next],
    )
    return next
  })
}

/**
 * Apply the bidirectional relation invariant: if A contains relation to B, B should contain
 * a mirroring relation to A. Pure function — does not write to DB.
 *
 * Returns a list of `{ contactId, rel }` pairs that should be appended to B.relationsInternal.
 * Existing mirrors (where B.relationsInternal already includes an entry with contactId === from)
 * are not duplicated.
 */
export function mirrorInternalRelation(
  contacts: Contact[],
  from: Ulid,
  to: Ulid,
  type?: string,
): { added: Array<{ contactId: Ulid; rel: InternalRelation }> } {
  const target = contacts.find((c) => c.id === to)
  if (!target) return { added: [] }

  // Check whether B already mirrors A
  const alreadyMirrored = (target.relationsInternal ?? []).some((r) => r.contactId === from)
  if (alreadyMirrored) return { added: [] }

  const rel: InternalRelation = type !== undefined ? { contactId: from, type } : { contactId: from }
  return { added: [{ contactId: to, rel }] }
}

/** Return list of customField keys present on the contact but not in `defIds`. */
export function validateCustomFieldKeys(c: Contact, defIds: Set<Ulid>): string[] {
  if (!c.customFields) return []
  return Object.keys(c.customFields).filter((k) => !defIds.has(k))
}

/**
 * Count how many fields in `edited` differ from `original`.
 * Shallow compare; arrays and objects compared via JSON.stringify.
 * Identity (same reference) → 0.
 * Used by P7.T5 to summarize "N field(s) changed" before confirming an edit on a protected contact.
 */
export function countChangedFields(original: Contact, edited: Contact): number {
  if (original === edited) return 0
  let diff = 0
  // Build a union key set; skip metadata fields that are normal to bump on every save.
  const skip = new Set(['updatedAt', 'lamportTs', 'deviceId'])
  const keys = new Set<string>([...Object.keys(original), ...Object.keys(edited)])
  for (const k of keys) {
    if (skip.has(k)) continue
    const a = (original as unknown as Record<string, unknown>)[k]
    const b = (edited as unknown as Record<string, unknown>)[k]
    if (a === b) continue
    if (typeof a === 'object' || typeof b === 'object') {
      if (JSON.stringify(a) !== JSON.stringify(b)) diff++
    } else {
      diff++
    }
  }
  return diff
}

/**
 * displayName fallback chain:
 *   explicit displayName → "given family" → nickname → "(no name)" / "(без имени)".
 */
export function computeDisplayName(
  c: Pick<Contact, 'displayName' | 'givenName' | 'familyName' | 'nickname'>,
  locale?: 'en' | 'ru',
): string {
  if (c.displayName) return c.displayName

  const parts = [c.givenName, c.familyName].filter(Boolean)
  if (parts.length > 0) return parts.join(' ')

  if (c.nickname) return c.nickname

  return locale === 'ru' ? '(без имени)' : '(no name)'
}
