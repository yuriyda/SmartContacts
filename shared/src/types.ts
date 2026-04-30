// Domain types for Smart Contacts.
// Authoritative reference: docs/superpowers/specs/2026-04-29-contacts-app-design.md §3.
// Do not add runtime logic here — types only.
// Multi-valued fields are JSON-serialized in DB columns; in TS they are arrays/objects.

/** ULID-shaped string (26 chars Crockford-Base32). Documents intent at field sites. */
export type Ulid = string

export interface Phone {
  value: string
  type?: string
  primary?: boolean
}
export interface Email {
  value: string
  type?: string
  primary?: boolean
}
export interface PostalAddress {
  street?: string
  city?: string
  region?: string
  postal?: string
  country?: string
  type?: string
  primary?: boolean
}
export interface CalendarEvent {
  date: string
  type: 'birthday' | 'anniversary' | 'custom'
}
export interface Organization {
  name?: string
  title?: string
  department?: string
  startDate?: string | null
  endDate?: string | null
  /** Mirrors Google `metadata.primary`. Local invariant: true iff `endDate == null`. */
  current?: boolean
}
export interface Url {
  value: string
  type?: string
}
export interface ImClient {
  protocol: string
  handle: string
}
export interface ExternalRelation {
  person: string
  type?: string
}
export interface InternalRelation {
  contactId: Ulid
  type?: string
}
export interface GroupMembership {
  id: string
  name?: string
}
export interface SocialDetected {
  platform: string
  handle: string
}
export interface Reminder {
  id: Ulid
  date: string
  text: string
  done?: boolean
}

export type CustomFieldType = 'text' | 'date' | 'number' | 'url' | 'boolean' | 'select'

interface CustomFieldDefBase {
  id: Ulid
  name: string
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  lamportTs: number
  deviceId: string
}
/** `select`-type defs require a non-empty `options` list. */
export interface SelectCustomFieldDef extends CustomFieldDefBase {
  type: 'select'
  options: string[]
}
/** Non-select defs never carry `options`. */
export interface ScalarCustomFieldDef extends CustomFieldDefBase {
  type: Exclude<CustomFieldType, 'select'>
}
export type CustomFieldDef = SelectCustomFieldDef | ScalarCustomFieldDef

export interface Contact {
  id: Ulid
  // Names
  givenName?: string
  familyName?: string
  middleName?: string
  honorificPrefix?: string
  honorificSuffix?: string
  phoneticGiven?: string
  phoneticFamily?: string
  displayName?: string
  nickname?: string
  // Multi-valued
  phones?: Phone[]
  emails?: Email[]
  addresses?: PostalAddress[]
  events?: CalendarEvent[]
  organizations?: Organization[]
  urls?: Url[]
  imClients?: ImClient[]
  relationsExternal?: ExternalRelation[]
  groups?: GroupMembership[]
  // Single-valued
  notesMd?: string
  /** Google passthrough; string-only values (Google enforces this). */
  userDefined?: Record<string, string>
  locale?: string
  gender?: string
  occupation?: string
  // Extensions
  tags?: string[]
  relationsInternal?: InternalRelation[]
  /** Keyed by `CustomFieldDef.id` (ULID). Values follow the def's `type`. */
  customFields?: Record<string, string | number | boolean | null>
  lastContactedAt?: string | null
  preferredChannel?: string
  priority?: number
  socialDetected?: SocialDetected[]
  reminders?: Reminder[]
  // Google integration
  googleResourceName?: string | null
  googleEtag?: string | null
  googleLastSyncedAt?: string | null
  // Avatar pointer
  avatarHash?: string | null
  // Sync metadata
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  lamportTs: number
  deviceId: string
}

export interface VectorClock {
  [deviceId: string]: number
}

export interface AvatarBlob {
  contactId: Ulid
  mime: string
  hash: string
  /**
   * Wire-format base64 string; transport-only.
   * Storage bridges (T8 wa-sqlite) MUST decode to `Uint8Array` before writing the BLOB column.
   */
  blobBase64: string
}

export interface SyncPackage {
  type: 'sync_package'
  deviceId: string | null
  vectorClock: VectorClock
  contacts: Contact[]
  customFieldDefs: CustomFieldDef[]
  avatars?: AvatarBlob[]
  settings?: Record<string, string>
}

export interface SyncRequest {
  type: 'sync_request'
  deviceId: string | null
  vectorClock: VectorClock
}

/** Discriminated union of sync wire messages. Narrow by `msg.type`. */
export type SyncMessage = SyncPackage | SyncRequest
