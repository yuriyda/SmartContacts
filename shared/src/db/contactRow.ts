// Row mapper for the `contacts` SQLite table.
// Converts between Contact (TS, camelCase, structured) and flat DB rows (snake_case, JSON-encoded).
// Rules:
//   - Do NOT import runtime logic from outside this file except Contact type.
//   - Encoding/decoding must be lossless: rowToContact(contactToRow(c)) deep-equals c.
//   - JSON helpers emit console.warn on malformed JSON but never throw.
//   - Required fields missing in a row cause a thrown Error (fast-fail, not silent corruption).

import type { Contact } from '../types'

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JSON-encoded array column.
 * - null/undefined input → undefined (field absent)
 * - '[]' → []
 * - '[...]' → parsed array
 * - malformed → fallback (default []) + console.warn
 */
function parseJsonArray<T>(s: unknown, fallback: T[] = []): T[] | undefined {
  if (s === null || s === undefined) return undefined
  if (typeof s !== 'string') {
    console.warn('contactRow: expected string for JSON-array column, got', typeof s)
    return fallback
  }
  try {
    const parsed = JSON.parse(s) as unknown
    if (!Array.isArray(parsed)) {
      console.warn('contactRow: JSON-array column is not an array:', s)
      return fallback
    }
    return parsed as T[]
  } catch {
    console.warn('contactRow: malformed JSON-array column:', s)
    return fallback
  }
}

/**
 * Parse a JSON-encoded object column.
 * - null/undefined input → undefined (field absent)
 * - '{}' → {}
 * - '{...}' → parsed object
 * - malformed → fallback (default {}) + console.warn
 */
function parseJsonObject<T extends Record<string, unknown>>(
  s: unknown,
  fallback: T = {} as T,
): T | undefined {
  if (s === null || s === undefined) return undefined
  if (typeof s !== 'string') {
    console.warn('contactRow: expected string for JSON-object column, got', typeof s)
    return fallback
  }
  try {
    const parsed = JSON.parse(s) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn('contactRow: JSON-object column is not an object:', s)
      return fallback
    }
    return parsed as T
  } catch {
    console.warn('contactRow: malformed JSON-object column:', s)
    return fallback
  }
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Encode optional TEXT field: undefined → null, value → value. */
function encText(v: string | undefined | null): string | null {
  return v ?? null
}

/** Encode JSON-array field: undefined → null, [] → '[]', [...] → JSON. */
function encArray(v: unknown[] | undefined): string | null {
  if (v === undefined) return null
  return JSON.stringify(v)
}

/** Encode JSON-object field: undefined → null, {} → '{}', {...} → JSON. */
function encObject(v: Record<string, unknown> | undefined): string | null {
  if (v === undefined) return null
  return JSON.stringify(v)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a nullable field that can be string | null | undefined.
 * - undefined → column is OMITTED from the row (so decoder sees it as absent → undefined)
 * - null      → column is present as null (decoder returns null)
 * - string    → column is present as the string value
 * This is different from encText which maps undefined → null.
 */
function encNullable(
  row: Record<string, unknown>,
  col: string,
  v: string | null | undefined,
): void {
  if (v === undefined) return // omit key → decoder will return undefined
  row[col] = v // null or string
}

/** Encode a Contact into a flat row matching the `contacts` DDL. */
export function contactToRow(c: Contact): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: c.id,
    given_name: encText(c.givenName),
    family_name: encText(c.familyName),
    middle_name: encText(c.middleName),
    honorific_prefix: encText(c.honorificPrefix),
    honorific_suffix: encText(c.honorificSuffix),
    phonetic_given: encText(c.phoneticGiven),
    phonetic_family: encText(c.phoneticFamily),
    display_name: encText(c.displayName),
    nickname: encText(c.nickname),
    phones: encArray(c.phones),
    emails: encArray(c.emails),
    addresses: encArray(c.addresses),
    events: encArray(c.events),
    organizations: encArray(c.organizations),
    urls: encArray(c.urls),
    im_clients: encArray(c.imClients),
    relations_external: encArray(c.relationsExternal),
    groups: encArray(c.groups),
    notes_md: encText(c.notesMd),
    user_defined: encObject(c.userDefined),
    locale: encText(c.locale),
    gender: encText(c.gender),
    occupation: encText(c.occupation),
    tags: encArray(c.tags),
    relations_internal: encArray(c.relationsInternal),
    custom_fields: encObject(c.customFields as Record<string, unknown> | undefined),
    preferred_channel: encText(c.preferredChannel),
    priority: c.priority !== undefined ? c.priority : null,
    protected: c.protected ? 1 : 0,
    hidden: c.hidden ? 1 : 0,
    social_detected: encArray(c.socialDetected),
    reminders: encArray(c.reminders),
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    lamport_ts: c.lamportTs,
    device_id: c.deviceId,
  }

  // Nullable fields: undefined → key omitted; null/string → key present.
  // This preserves null vs undefined across the round-trip.
  encNullable(row, 'last_contacted_at', c.lastContactedAt)
  encNullable(row, 'google_resource_name', c.googleResourceName)
  encNullable(row, 'google_etag', c.googleEtag)
  encNullable(row, 'google_last_synced_at', c.googleLastSyncedAt)
  encNullable(row, 'avatar_hash', c.avatarHash)
  encNullable(row, 'deleted_at', c.deletedAt)

  return row
}

/** Require a column in the row; throw a descriptive error if absent. */
function requireCol(row: Record<string, unknown>, col: string): unknown {
  if (!(col in row)) {
    throw new Error(`contactRow: missing required column ${col}`)
  }
  return row[col]
}

/** Decode a row from `contacts` back into a Contact (deep-equal round-trip). */
export function rowToContact(row: Record<string, unknown>): Contact {
  // Validate required columns first (fast-fail).
  const id = requireCol(row, 'id') as string
  const createdAt = requireCol(row, 'created_at') as string
  const updatedAt = requireCol(row, 'updated_at') as string
  const lamportTs = requireCol(row, 'lamport_ts') as number
  const deviceId = requireCol(row, 'device_id') as string

  // Helper: read optional TEXT → string | undefined
  const optText = (col: string): string | undefined => {
    const v = row[col]
    return v != null ? String(v) : undefined
  }

  // Helper: read nullable TEXT → string | null | undefined
  // Returns null when column is present and null, undefined when column is absent.
  const nullableText = (col: string): string | null | undefined => {
    if (!(col in row)) return undefined
    const v = row[col]
    return v == null ? null : String(v)
  }

  const contact: Contact = {
    id,
    createdAt,
    updatedAt,
    lamportTs,
    deviceId,
  }

  // Optional text fields
  const givenName = optText('given_name')
  if (givenName !== undefined) contact.givenName = givenName
  const familyName = optText('family_name')
  if (familyName !== undefined) contact.familyName = familyName
  const middleName = optText('middle_name')
  if (middleName !== undefined) contact.middleName = middleName
  const honorificPrefix = optText('honorific_prefix')
  if (honorificPrefix !== undefined) contact.honorificPrefix = honorificPrefix
  const honorificSuffix = optText('honorific_suffix')
  if (honorificSuffix !== undefined) contact.honorificSuffix = honorificSuffix
  const phoneticGiven = optText('phonetic_given')
  if (phoneticGiven !== undefined) contact.phoneticGiven = phoneticGiven
  const phoneticFamily = optText('phonetic_family')
  if (phoneticFamily !== undefined) contact.phoneticFamily = phoneticFamily
  const displayName = optText('display_name')
  if (displayName !== undefined) contact.displayName = displayName
  const nickname = optText('nickname')
  if (nickname !== undefined) contact.nickname = nickname
  const notesMd = optText('notes_md')
  if (notesMd !== undefined) contact.notesMd = notesMd
  const locale = optText('locale')
  if (locale !== undefined) contact.locale = locale
  const gender = optText('gender')
  if (gender !== undefined) contact.gender = gender
  const occupation = optText('occupation')
  if (occupation !== undefined) contact.occupation = occupation
  const preferredChannel = optText('preferred_channel')
  if (preferredChannel !== undefined) contact.preferredChannel = preferredChannel

  // priority: optional integer
  if (row['priority'] != null) contact.priority = row['priority'] as number

  // protected / hidden: INTEGER 0/1 — set only when truthy (1); omit when 0/null/undefined.
  // This satisfies exactOptionalPropertyTypes: never assign false, only true or omit.
  if (row['protected']) contact.protected = true
  if (row['hidden']) contact.hidden = true

  // Nullable text fields: null must be preserved (distinct from undefined/absent)
  const deletedAt = nullableText('deleted_at')
  if (deletedAt !== undefined) contact.deletedAt = deletedAt
  const lastContactedAt = nullableText('last_contacted_at')
  if (lastContactedAt !== undefined) contact.lastContactedAt = lastContactedAt
  const googleResourceName = nullableText('google_resource_name')
  if (googleResourceName !== undefined) contact.googleResourceName = googleResourceName
  const googleEtag = nullableText('google_etag')
  if (googleEtag !== undefined) contact.googleEtag = googleEtag
  const googleLastSyncedAt = nullableText('google_last_synced_at')
  if (googleLastSyncedAt !== undefined) contact.googleLastSyncedAt = googleLastSyncedAt
  const avatarHash = nullableText('avatar_hash')
  if (avatarHash !== undefined) contact.avatarHash = avatarHash

  // JSON-array fields
  const phones = parseJsonArray<import('../types').Phone>(row['phones'])
  if (phones !== undefined) contact.phones = phones
  const emails = parseJsonArray<import('../types').Email>(row['emails'])
  if (emails !== undefined) contact.emails = emails
  const addresses = parseJsonArray<import('../types').PostalAddress>(row['addresses'])
  if (addresses !== undefined) contact.addresses = addresses
  const events = parseJsonArray<import('../types').CalendarEvent>(row['events'])
  if (events !== undefined) contact.events = events
  const organizations = parseJsonArray<import('../types').Organization>(row['organizations'])
  if (organizations !== undefined) contact.organizations = organizations
  const urls = parseJsonArray<import('../types').Url>(row['urls'])
  if (urls !== undefined) contact.urls = urls
  const imClients = parseJsonArray<import('../types').ImClient>(row['im_clients'])
  if (imClients !== undefined) contact.imClients = imClients
  const relationsExternal = parseJsonArray<import('../types').ExternalRelation>(
    row['relations_external'],
  )
  if (relationsExternal !== undefined) contact.relationsExternal = relationsExternal
  const groups = parseJsonArray<import('../types').GroupMembership>(row['groups'])
  if (groups !== undefined) contact.groups = groups
  const tags = parseJsonArray<string>(row['tags'])
  if (tags !== undefined) contact.tags = tags
  const relationsInternal = parseJsonArray<import('../types').InternalRelation>(
    row['relations_internal'],
  )
  if (relationsInternal !== undefined) contact.relationsInternal = relationsInternal
  const socialDetected = parseJsonArray<import('../types').SocialDetected>(row['social_detected'])
  if (socialDetected !== undefined) contact.socialDetected = socialDetected
  const reminders = parseJsonArray<import('../types').Reminder>(row['reminders'])
  if (reminders !== undefined) contact.reminders = reminders

  // JSON-object fields
  const userDefined = parseJsonObject<Record<string, string>>(row['user_defined'])
  if (userDefined !== undefined) contact.userDefined = userDefined
  const customFields = parseJsonObject<Record<string, string | number | boolean | null>>(
    row['custom_fields'],
  )
  if (customFields !== undefined) contact.customFields = customFields

  return contact
}
