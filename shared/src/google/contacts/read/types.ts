// RO-INVARIANT: defines types used by pure pipeline stages (no I/O).
// Covers INV-1 (pull-only), INV-3 (snapshot-based merge types).
// This file is types-only — no runtime logic.
// All Google People API shapes are minimal read-only projections.
// Do not add write-side types here; see Phase 2 spec when written.

// ---------------------------------------------------------------------------
// People API v1 — field metadata
// ---------------------------------------------------------------------------

export interface FieldMetadata {
  primary?: boolean
  sourcePrimary?: boolean
  verified?: boolean
}

// ---------------------------------------------------------------------------
// People API v1 — sub-field shapes
// ---------------------------------------------------------------------------

export interface Name {
  metadata?: FieldMetadata
  displayName?: string
  familyName?: string
  givenName?: string
  middleName?: string
  honorificPrefix?: string
  honorificSuffix?: string
  phoneticFamilyName?: string
  phoneticGivenName?: string
  phoneticMiddleName?: string
}

export interface Nickname {
  metadata?: FieldMetadata
  value?: string
  type?: string
}

export interface PhoneNumber {
  metadata?: FieldMetadata
  value?: string
  canonicalForm?: string
  type?: string
  formattedType?: string
}

export interface EmailAddress {
  metadata?: FieldMetadata
  value?: string
  type?: string
  formattedType?: string
  displayName?: string
}

export interface Address {
  metadata?: FieldMetadata
  formattedValue?: string
  type?: string
  formattedType?: string
  poBox?: string
  streetAddress?: string
  extendedAddress?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
  countryCode?: string
}

export interface Organization {
  metadata?: FieldMetadata
  name?: string
  title?: string
  department?: string
  jobDescription?: string
  symbol?: string
  domain?: string
  location?: string
  type?: string
  formattedType?: string
  startDate?: PersonDate
  endDate?: PersonDate
  current?: boolean
}

/** Partial date as returned by People API (year/month/day all optional). */
export interface PersonDate {
  year?: number
  month?: number
  day?: number
}

export interface Event {
  metadata?: FieldMetadata
  date?: PersonDate
  type?: string
  formattedType?: string
}

export interface Url {
  metadata?: FieldMetadata
  value?: string
  type?: string
  formattedType?: string
}

export interface ImClient {
  metadata?: FieldMetadata
  username?: string
  protocol?: string
  formattedProtocol?: string
  type?: string
  formattedType?: string
}

export interface Biography {
  metadata?: FieldMetadata
  value?: string
  contentType?: string
}

export interface UserDefined {
  metadata?: FieldMetadata
  key?: string
  value?: string
}

export interface Locale {
  metadata?: FieldMetadata
  value?: string
}

export interface Gender {
  metadata?: FieldMetadata
  value?: string
  formattedValue?: string
  addressMeAs?: string
}

export interface Occupation {
  metadata?: FieldMetadata
  value?: string
}

export interface ContactGroupMembership {
  contactGroupId?: string
  contactGroupResourceName?: string
}

export interface DomainMembership {
  inViewerDomain?: boolean
}

export interface Membership {
  metadata?: FieldMetadata
  contactGroupMembership?: ContactGroupMembership
  domainMembership?: DomainMembership
}

export interface Photo {
  metadata?: FieldMetadata
  url?: string
  default?: boolean
}

export interface PersonMetadata {
  sources?: Array<{
    type?: string
    id?: string
    etag?: string
    updateTime?: string
  }>
  deleted?: boolean
  objectType?: string
}

// ---------------------------------------------------------------------------
// People API v1 — top-level Person
// ---------------------------------------------------------------------------

export interface Person {
  resourceName?: string
  etag?: string
  metadata?: PersonMetadata
  names?: Name[]
  nicknames?: Nickname[]
  phoneNumbers?: PhoneNumber[]
  emailAddresses?: EmailAddress[]
  addresses?: Address[]
  organizations?: Organization[]
  events?: Event[]
  urls?: Url[]
  imClients?: ImClient[]
  biographies?: Biography[]
  userDefined?: UserDefined[]
  locales?: Locale[]
  genders?: Gender[]
  occupations?: Occupation[]
  memberships?: Membership[]
  photos?: Photo[]
}

// ---------------------------------------------------------------------------
// Normalized contact — the canonical in-memory shape for the read pipeline.
// Field names mirror shared/src/types.ts Contact where possible.
// Smart-Contacts-only fields (tags, priority, protected, hidden, etc.) are
// intentionally absent — they do not come from Google.
// ---------------------------------------------------------------------------

export interface NormalizedPhone {
  value: string
  type?: string | undefined
  label?: string | undefined
}

export interface NormalizedEmail {
  value: string
  type?: string | undefined
  label?: string | undefined
}

export interface NormalizedAddress {
  street?: string | undefined
  city?: string | undefined
  region?: string | undefined
  postal?: string | undefined
  country?: string | undefined
  type?: string | undefined
}

export interface NormalizedEvent {
  type: string
  date: string
}

export interface NormalizedOrganization {
  name?: string | undefined
  title?: string | undefined
  department?: string | undefined
  startDate?: string | null | undefined
  endDate?: string | null | undefined
  current?: boolean | undefined
}

export interface NormalizedUrl {
  value: string
  type?: string | undefined
}

export interface NormalizedImClient {
  protocol: string
  handle: string
}

export interface NormalizedContact {
  googleResourceName: string
  etag: string
  updateTime: string
  // Names
  displayName?: string | undefined
  givenName?: string | undefined
  familyName?: string | undefined
  middleName?: string | undefined
  honorificPrefix?: string | undefined
  honorificSuffix?: string | undefined
  phoneticGiven?: string | undefined
  phoneticFamily?: string | undefined
  nickname?: string | undefined
  // Multi-valued
  phones: NormalizedPhone[]
  emails: NormalizedEmail[]
  addresses: NormalizedAddress[]
  events: NormalizedEvent[]
  organizations: NormalizedOrganization[]
  urls: NormalizedUrl[]
  imClients: NormalizedImClient[]
  // Single-valued
  notesMd?: string | undefined
  userDefined: Record<string, string>
  locale?: string | undefined
  gender?: string | undefined
  occupation?: string | undefined
  // Photo
  photoUrl: string | null
  photoContentHash: string | null
  // Google labels (INV-4: read-only namespace, never merged into local tags)
  labelResourceNames: string[]
}

// ---------------------------------------------------------------------------
// Changeset and ConflictRecord — re-exported from differ.ts (single source of truth).
// Spec §3.3 and §4.2. differ.ts owns the canonical definitions.
// ---------------------------------------------------------------------------

export type { Changeset, ConflictRecord } from './differ.js'

// ---------------------------------------------------------------------------
// People API v1 — ContactGroup (added for T5 GoogleContactsClient)
// ---------------------------------------------------------------------------

export interface ContactGroupMetadata {
  updateTime?: string
  deleted?: boolean
}

export interface ContactGroup {
  resourceName: string
  etag: string
  metadata?: ContactGroupMetadata
  groupType?: 'SYSTEM_CONTACT_GROUP' | 'USER_CONTACT_GROUP'
  name: string
  formattedName?: string
  memberCount?: number
}

// ---------------------------------------------------------------------------
// People API v1 — paginated list responses (added for T5 GoogleContactsClient)
// ---------------------------------------------------------------------------

export interface ListConnectionsResponse {
  connections?: Person[]
  nextPageToken?: string
  nextSyncToken?: string
  totalPeople?: number
}

export interface ListContactGroupsResponse {
  contactGroups?: ContactGroup[]
  nextPageToken?: string
  totalItems?: number
}
