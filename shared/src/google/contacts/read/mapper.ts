// RO-INVARIANT: INV-3 — snapshot-based three-way merge depends on this mapper
// to produce a stable NormalizedContact from a raw People API Person.
// Pure function, no I/O, no side effects.
// Do not import runtime DB or fetch utilities here.
// All normalization rules (phone stripping, email lowercasing) are documented
// inline. Replace phone normalization with libphonenumber if added as a dep.

import type {
  Person,
  PersonDate,
  NormalizedContact,
  NormalizedPhone,
  NormalizedEmail,
  NormalizedAddress,
  NormalizedEvent,
  NormalizedOrganization,
  NormalizedUrl,
  NormalizedImClient,
} from './types.js'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip all characters except digits and a leading '+'.
 * TODO: replace with libphonenumber-js if that package is added later.
 */
function normalizePhone(raw: string): string {
  // Preserve leading '+' for international prefix, then keep only digits.
  const trimmed = raw.trim()
  const plus = trimmed.startsWith('+') ? '+' : ''
  const digits = trimmed.replace(/\D/g, '')
  return plus + digits
}

/**
 * Build an ISO-8601 date string (YYYY-MM-DD) from a People API PersonDate.
 * Absent parts are substituted with '00' to keep the string parseable.
 */
function personDateToString(d: PersonDate): string {
  const y = d.year ?? 0
  const m = String(d.month ?? 0).padStart(2, '0')
  const day = String(d.day ?? 0).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ---------------------------------------------------------------------------
// Public mapper
// ---------------------------------------------------------------------------

/**
 * Convert a raw People API Person into a NormalizedContact.
 * Called by the differ (T12) to compare the remote state against snapshots
 * and local contacts.
 */
export function personToNormalized(p: Person): NormalizedContact {
  // --- scalar identity ---
  const resourceName = p.resourceName ?? ''
  const etag = p.etag ?? ''
  const updateTime = p.metadata?.sources?.[0]?.updateTime ?? ''

  // --- names (primary = first element) ---
  const name = p.names?.[0]
  const displayName = name?.displayName
  const givenName = name?.givenName
  const familyName = name?.familyName
  const middleName = name?.middleName
  const honorificPrefix = name?.honorificPrefix
  const honorificSuffix = name?.honorificSuffix
  const phoneticGiven = name?.phoneticGivenName
  const phoneticFamily = name?.phoneticFamilyName

  // --- nickname ---
  const nickname = p.nicknames?.[0]?.value

  // --- phones ---
  const phones: NormalizedPhone[] = (p.phoneNumbers ?? []).map((pn) => ({
    value: normalizePhone(pn.value ?? ''),
    type: pn.type,
    label: pn.formattedType,
  }))

  // --- emails ---
  const emails: NormalizedEmail[] = (p.emailAddresses ?? []).map((e) => ({
    value: (e.value ?? '').toLowerCase().trim(),
    type: e.type,
    label: e.formattedType,
  }))

  // --- addresses ---
  const addresses: NormalizedAddress[] = (p.addresses ?? []).map((a) => ({
    street: a.streetAddress,
    city: a.city,
    region: a.region,
    postal: a.postalCode,
    country: a.country,
    type: a.type,
  }))

  // --- organizations ---
  const organizations: NormalizedOrganization[] = (p.organizations ?? []).map((o) => ({
    name: o.name,
    title: o.title,
    department: o.department,
    startDate: o.startDate ? personDateToString(o.startDate) : null,
    endDate: o.endDate ? personDateToString(o.endDate) : null,
    current: o.current,
  }))

  // --- events ---
  const events: NormalizedEvent[] = (p.events ?? [])
    .filter((e) => e.date != null)
    .map((e) => ({
      type: e.type ?? 'custom',
      date: personDateToString(e.date!),
    }))

  // --- urls ---
  const urls: NormalizedUrl[] = (p.urls ?? []).map((u) => ({
    value: (u.value ?? '').toLowerCase(),
    type: u.type,
  }))

  // --- IM clients ---
  const imClients: NormalizedImClient[] = (p.imClients ?? []).map((im) => ({
    protocol: im.protocol ?? im.formattedProtocol ?? '',
    handle: im.username ?? '',
  }))

  // --- biography → notesMd (first entry, plain text preferred) ---
  const notesMd = p.biographies?.[0]?.value

  // --- userDefined key-value pairs ---
  const userDefined: Record<string, string> = Object.fromEntries(
    (p.userDefined ?? []).filter((u) => u.key != null).map((u) => [u.key as string, u.value ?? '']),
  )

  // --- locale ---
  const locale = p.locales?.[0]?.value

  // --- gender ---
  const gender = p.genders?.[0]?.formattedValue ?? p.genders?.[0]?.value

  // --- occupation ---
  const occupation = p.occupations?.[0]?.value

  // --- photo: prefer the one marked default, fall back to first ---
  const defaultPhoto = p.photos?.find((ph) => ph.default === true)
  const photoUrl = defaultPhoto?.url ?? p.photos?.[0]?.url ?? null

  // photoContentHash is filled by the fetcher after downloading the image;
  // mapper always leaves it null.
  const photoContentHash: string | null = null

  // --- Google Label resource names (INV-4: stored separately, never merged into local tags) ---
  const labelResourceNames: string[] = (p.memberships ?? [])
    .filter((m) => m.contactGroupMembership != null)
    .map((m) => m.contactGroupMembership!.contactGroupResourceName ?? '')
    .filter((rn) => rn !== '')

  return {
    googleResourceName: resourceName,
    etag,
    updateTime,
    displayName,
    givenName,
    familyName,
    middleName,
    honorificPrefix,
    honorificSuffix,
    phoneticGiven,
    phoneticFamily,
    nickname,
    phones,
    emails,
    addresses,
    events,
    organizations,
    urls,
    imClients,
    notesMd,
    userDefined,
    locale,
    gender,
    occupation,
    photoUrl,
    photoContentHash,
    labelResourceNames,
  }
}
