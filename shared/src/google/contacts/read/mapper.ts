// RO-INVARIANT: INV-3 — snapshot-based three-way merge depends on this mapper
// to produce a stable NormalizedContact from a raw People API Person.
// Pure function, no I/O, no side effects.
// Do not import runtime DB or fetch utilities here.
// All normalization rules (phone stripping, email lowercasing) are documented
// inline. Replace phone normalization with libphonenumber if added as a dep.
//
// contactRowToNormalized: converts a local Contact row to NormalizedContact for
// the pull-engine's "ours" side. Local-only fields (tags, reminders, etc.) are
// intentionally omitted — NormalizedContact only carries Google-intersecting fields.

import type {
  Person,
  PersonDate,
  NormalizedContact,
  NormalizedPhone,
  NormalizedEmail,
  NormalizedAddress,
  NormalizedEvent,
  NormalizedBirthday,
  NormalizedRelation,
  NormalizedOrganization,
  NormalizedUrl,
  NormalizedImClient,
} from './types.js'
import type { Contact } from '../../../types.js'

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

  // --- birthdays (kept separate from events for clarity; People API has a dedicated array) ---
  const birthdays: NormalizedBirthday[] = (p.birthdays ?? [])
    .filter(
      (b) => b.date != null && (b.date.year != null || b.date.month != null || b.date.day != null),
    )
    .map((b) => ({
      year: b.date!.year,
      month: b.date!.month,
      day: b.date!.day,
    }))

  // --- relations ---
  const relations: NormalizedRelation[] = (p.relations ?? [])
    .filter((r) => r.person != null && r.person !== '')
    .map((r) => ({
      person: r.person as string,
      type: r.type,
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

  // --- photo: take the first user-uploaded photo; ignore Google's default
  // placeholder. People API marks the gray silhouette / generic avatar with
  // `default: true` — that is NOT a real user photo, just Google's stand-in.
  // Storing the placeholder URL here would later make every Google contact
  // light up the "has profile photo" marker, which is wrong. ---
  const realPhoto = p.photos?.find((ph) => ph.default !== true && ph.url != null)
  const photoUrl = realPhoto?.url ?? null

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
    birthdays,
    relations,
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

// ---------------------------------------------------------------------------
// Local Contact row → NormalizedContact
// ---------------------------------------------------------------------------

/**
 * Convert a local Contact row to a NormalizedContact for the pull-engine "ours" side.
 *
 * Local-only fields (tags, customFields, priority, protected, hidden, socialDetected,
 * reminders, lastContactedAt, preferredChannel, relationsInternal, createdAt, updatedAt,
 * deletedAt, lamportTs, deviceId) are intentionally absent from NormalizedContact and
 * are skipped here.
 *
 * labelResourceNames is set to [] — labels live in google_label_memberships, not on the
 * contact row. Per INV-4 the differ handles label three-way merge via theirLabelMemberships,
 * not via ours's labelResourceNames.
 */
export function contactRowToNormalized(c: Contact): NormalizedContact {
  // Map phones: Contact.Phone has { value, type?, primary? } →
  // NormalizedPhone has { value, type?, label? }. `primary` is local-only; `label` is absent.
  const phones: NormalizedPhone[] = (c.phones ?? []).map((p) => ({
    value: p.value,
    type: p.type,
    label: undefined,
  }))

  // Map emails: same shape difference as phones.
  const emails: NormalizedEmail[] = (c.emails ?? []).map((e) => ({
    value: e.value,
    type: e.type,
    label: undefined,
  }))

  // Map addresses: Contact.PostalAddress has { street?, city?, region?, postal?, country?, type?, primary? }
  // NormalizedAddress has { street?, city?, region?, postal?, country?, type? }. Drop primary.
  const addresses: NormalizedAddress[] = (c.addresses ?? []).map((a) => ({
    street: a.street,
    city: a.city,
    region: a.region,
    postal: a.postal,
    country: a.country,
    type: a.type,
  }))

  // Map organizations: shapes are identical for shared fields.
  const organizations: NormalizedOrganization[] = (c.organizations ?? []).map((o) => ({
    name: o.name,
    title: o.title,
    department: o.department,
    startDate: o.startDate,
    endDate: o.endDate,
    current: o.current,
  }))

  // Map events: Contact.CalendarEvent has { date: string, type: 'birthday' | 'anniversary' | 'custom' }
  // NormalizedEvent has { type: string, date: string }. Compatible; just reorder.
  const events: NormalizedEvent[] = (c.events ?? []).map((e) => ({
    type: e.type,
    date: e.date,
  }))

  // Map urls: Contact.Url has { value, type? } — same as NormalizedUrl.
  const urls: NormalizedUrl[] = (c.urls ?? []).map((u) => ({
    value: u.value,
    type: u.type,
  }))

  // Map imClients: Contact.ImClient has { protocol, handle } — same as NormalizedImClient.
  const imClients: NormalizedImClient[] = (c.imClients ?? []).map((im) => ({
    protocol: im.protocol,
    handle: im.handle,
  }))

  // birthdays and relations are stored as separate DB columns (v3 migration);
  // Contact row does not carry them natively — read from googleBirthdays/googleRelations if available.
  // These are stored as JSON on the contact row via migration v3 columns decoded via rowToContact extensions.
  // For now, contactRowToNormalized returns empty arrays (these fields are Google-sourced, not local-edited).
  const birthdays: NormalizedBirthday[] =
    (c as unknown as { googleBirthdays?: NormalizedBirthday[] }).googleBirthdays ?? []
  const relations: NormalizedRelation[] =
    (c as unknown as { googleRelations?: NormalizedRelation[] }).googleRelations ?? []

  return {
    googleResourceName: c.googleResourceName ?? '',
    etag: c.googleEtag ?? '',
    // updateTime is Google's server-side timestamp — not stored on Contact row.
    updateTime: '',
    displayName: c.displayName,
    givenName: c.givenName,
    familyName: c.familyName,
    middleName: c.middleName,
    honorificPrefix: c.honorificPrefix,
    honorificSuffix: c.honorificSuffix,
    phoneticGiven: c.phoneticGiven,
    phoneticFamily: c.phoneticFamily,
    nickname: c.nickname,
    phones,
    emails,
    addresses,
    events,
    birthdays,
    relations,
    organizations,
    urls,
    imClients,
    notesMd: c.notesMd,
    userDefined: c.userDefined ?? {},
    locale: c.locale,
    gender: c.gender,
    occupation: c.occupation,
    // photoUrl is not stored on Contact row — only photoContentHash via avatarHash.
    photoUrl: null,
    photoContentHash: c.avatarHash ?? null,
    // Labels live in google_label_memberships; per INV-4 left empty here.
    labelResourceNames: [],
  }
}
