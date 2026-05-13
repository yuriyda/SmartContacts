// RO-INVARIANT: INV-3 (three-way merge), INV-5 (conflict queue semantics).
//
// Pure function. No I/O. No async. Idempotent: same inputs → same Changeset.
// All decisions about applying or queuing are made here; differ.ts NEVER mutates DB.
//
// Safety invariants:
//  - Conflict resolution defaults to PRESERVING `ours` — never silently overwrite local data.
//  - Base snapshot is NOT updated for conflicting fields (only cleanUpdates include base updates).
//  - Output ordering MUST be deterministic (sort by googleResourceName ASC) to support idempotency.
//  - No `any` — use `unknown` with narrowing.
//  - Array element identity keys are stable semantic keys (spec §6.3).

import type {
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
import type { GoogleLabelRow } from './label-repo.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One field-level change to apply to a local contact. */
export interface FieldUpdate {
  contactId: string
  googleResourceName: string
  fieldPath: string
  newValue: unknown
}

/** One pending conflict row — mirrors sync_conflicts table shape (spec §4.2). */
export interface ConflictRecord {
  contactId: string
  googleResourceName: string
  fieldPath: string
  baseValueJson: string | null
  googleValueJson: string | null
  localValueJson: string
  detectedAt: string
}

/**
 * Full dry-run output (spec §3.3, §6.7, INV-2).
 * cleanInserts / cleanUpdates / cleanDeletes are safe to apply without user confirmation.
 * conflicts must be queued for user resolution.
 * labels are always full-replace (INV-4).
 */
export interface Changeset {
  runId: string
  cleanInserts: NormalizedContact[]
  cleanUpdates: FieldUpdate[]
  cleanDeletes: string[] // contact IDs (googleResourceName used as surrogate)
  conflicts: ConflictRecord[]
  labels: {
    full: GoogleLabelRow[]
    memberships: Map<string, string[]> // contactId -> labelResourceNames
  }
  /**
   * Map from googleResourceName → current Google NormalizedContact for contacts
   * that have cleanUpdates. Used by the applier to upsert snapshots after updates.
   * Not used for inserts (those use cleanInserts directly).
   */
  updatedNormalized: Map<string, NormalizedContact>
  counts: {
    inserts: number
    updates: number
    deletes: number
    conflicts: number
  }
}

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface ComputeChangesetInput {
  runId: string
  /** Snapshots keyed by googleResourceName — the merge base. */
  snapshots: Map<string, NormalizedContact>
  /** Current Google version of all contacts. */
  theirs: NormalizedContact[]
  /** resourceNames removed in Google since last sync. */
  deletedRemotely: string[]
  /** Current local Google-imported contacts (WHERE googleResourceName IS NOT NULL). */
  ours: NormalizedContact[]
  theirLabels: GoogleLabelRow[]
  /** resourceName -> labelResourceNames */
  theirLabelMemberships: Map<string, string[]>
  /** ISO timestamp for detected_at on conflicts. */
  now: string
}

// ---------------------------------------------------------------------------
// Deep equality helper
// ---------------------------------------------------------------------------

/** JSON-stringify-based deep equality. Safe for plain data objects. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (a === undefined || b === undefined) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

// ---------------------------------------------------------------------------
// Scalar merge result
// ---------------------------------------------------------------------------

type ScalarMergeResult = 'noop' | 'apply-theirs' | 'keep-ours' | 'conflict'

/**
 * Implements the five-row scalar merge matrix from spec §6.2.
 * Returns the action to take; caller records conflict or update accordingly.
 */
function mergeScalar(
  _fieldPath: string,
  oursVal: unknown,
  baseVal: unknown,
  theirsVal: unknown,
): ScalarMergeResult {
  const oursEqBase = deepEqual(oursVal, baseVal)
  const theirsEqBase = deepEqual(theirsVal, baseVal)

  if (oursEqBase && theirsEqBase) return 'noop'
  if (oursEqBase && !theirsEqBase) return 'apply-theirs'
  if (!oursEqBase && theirsEqBase) return 'keep-ours'
  // Both differ from base
  if (deepEqual(oursVal, theirsVal)) return 'apply-theirs' // converged — apply theirs, update base
  return 'conflict'
}

// ---------------------------------------------------------------------------
// Array element key functions (spec §6.3)
// ---------------------------------------------------------------------------

function phoneKey(p: NormalizedPhone): string {
  return p.value.replace(/[^\d+]/g, '')
}

function emailKey(e: NormalizedEmail): string {
  return e.value.toLowerCase().trim()
}

function addressKey(a: NormalizedAddress): string {
  return JSON.stringify([
    (a.street ?? '').trim(),
    (a.postal ?? '').trim(),
    (a.city ?? '').trim(),
    (a.country ?? '').trim(),
  ])
}

function eventKey(e: NormalizedEvent): string {
  return `${e.type}|${e.date}`
}

function orgKey(o: NormalizedOrganization): string {
  return `${o.name ?? ''}|${o.title ?? ''}`
}

function urlKey(u: NormalizedUrl): string {
  return u.value.toLowerCase().trim()
}

function imKey(im: NormalizedImClient): string {
  return `${im.protocol}|${im.handle}`
}

function birthdayKey(b: NormalizedBirthday): string {
  return `${b.year ?? ''}-${String(b.month ?? '').padStart(2, '0')}-${String(b.day ?? '').padStart(2, '0')}`
}

function relationKey(r: NormalizedRelation): string {
  return `${r.person}|${r.type ?? ''}`
}

// ---------------------------------------------------------------------------
// Generic array merge
// ---------------------------------------------------------------------------

/**
 * Performs the three-way set-union array merge per spec §6.3.
 * Returns { updates, conflicts } for one array field.
 */
function mergeArray<T>(
  fieldName: string,
  oursArr: T[],
  baseArr: T[],
  theirsArr: T[],
  keyFn: (item: T) => string,
  contactId: string,
  googleResourceName: string,
  now: string,
): { newArray: T[]; updates: FieldUpdate[]; conflicts: ConflictRecord[] } {
  const oursMap = new Map<string, T>(oursArr.map((x) => [keyFn(x), x]))
  const baseMap = new Map<string, T>(baseArr.map((x) => [keyFn(x), x]))
  const theirsMap = new Map<string, T>(theirsArr.map((x) => [keyFn(x), x]))

  // Union of all keys
  const allKeys = new Set<string>([...oursMap.keys(), ...baseMap.keys(), ...theirsMap.keys()])

  const resultMap = new Map<string, T>(oursMap)
  const updates: FieldUpdate[] = []
  const conflicts: ConflictRecord[] = []

  for (const key of allKeys) {
    const inBase = baseMap.has(key)
    const inTheirs = theirsMap.has(key)
    const inOurs = oursMap.has(key)

    const oursEl = oursMap.get(key)
    const baseEl = baseMap.get(key)
    const theirsEl = theirsMap.get(key)

    if (inBase && !inTheirs) {
      // Deleted remotely
      if (inOurs) {
        if (deepEqual(oursEl, baseEl)) {
          // ours unchanged from base → confirmed deletion
          resultMap.delete(key)
          updates.push({
            contactId,
            googleResourceName,
            fieldPath: fieldName,
            newValue: undefined,
          })
        } else {
          // ours edited the element → conflict
          conflicts.push({
            contactId,
            googleResourceName,
            fieldPath: `${fieldName}[${key}]:deleted_remotely`,
            baseValueJson: JSON.stringify(baseEl),
            googleValueJson: null,
            localValueJson: JSON.stringify(oursEl),
            detectedAt: now,
          })
        }
      }
      // If not in ours — element already locally deleted, confirmed deletion, no-op
      continue
    }

    if (!inBase && inTheirs) {
      // Added remotely
      if (!inOurs) {
        // Not locally present → add it
        resultMap.set(key, theirsEl as T)
        updates.push({
          contactId,
          googleResourceName,
          fieldPath: fieldName,
          newValue: undefined,
        })
      } else {
        // Already in ours
        if (deepEqual(oursEl, theirsEl)) {
          // Already converged → no-op
        } else {
          // Diverged addition
          conflicts.push({
            contactId,
            googleResourceName,
            fieldPath: `${fieldName}[${key}]:added_diverged`,
            baseValueJson: null,
            googleValueJson: JSON.stringify(theirsEl),
            localValueJson: JSON.stringify(oursEl),
            detectedAt: now,
          })
        }
      }
      continue
    }

    if (inBase && inTheirs && !inOurs) {
      // Deleted locally
      if (deepEqual(theirsEl, baseEl)) {
        // Theirs unchanged → confirmed local deletion, no-op (don't re-add)
      } else {
        // Theirs changed after we deleted it
        conflicts.push({
          contactId,
          googleResourceName,
          fieldPath: `${fieldName}[${key}]:deleted_locally_but_remote_changed`,
          baseValueJson: JSON.stringify(baseEl),
          googleValueJson: JSON.stringify(theirsEl),
          localValueJson: JSON.stringify(null),
          detectedAt: now,
        })
      }
      continue
    }

    if (inBase && inTheirs && inOurs) {
      // Element present in all three — apply scalar-like merge on sub-fields
      const result = mergeScalar(`${fieldName}[${key}]`, oursEl, baseEl, theirsEl)
      if (result === 'apply-theirs') {
        resultMap.set(key, theirsEl as T)
        if (!deepEqual(oursEl, theirsEl)) {
          updates.push({
            contactId,
            googleResourceName,
            fieldPath: fieldName,
            newValue: undefined,
          })
        }
      } else if (result === 'conflict') {
        conflicts.push({
          contactId,
          googleResourceName,
          fieldPath: `${fieldName}[${key}]:diverged`,
          baseValueJson: JSON.stringify(baseEl),
          googleValueJson: JSON.stringify(theirsEl),
          localValueJson: JSON.stringify(oursEl),
          detectedAt: now,
        })
      }
      // 'noop' or 'keep-ours': leave resultMap as-is
      continue
    }

    // Not in base (new in both ours and theirs) — if both have it, they were added independently
    if (!inBase && inTheirs && inOurs) {
      if (!deepEqual(oursEl, theirsEl)) {
        conflicts.push({
          contactId,
          googleResourceName,
          fieldPath: `${fieldName}[${key}]:added_diverged`,
          baseValueJson: null,
          googleValueJson: JSON.stringify(theirsEl),
          localValueJson: JSON.stringify(oursEl),
          detectedAt: now,
        })
      }
      // else: same value in both, no-op
    }
  }

  const newArray = Array.from(resultMap.values())
  // Deduplicate updates for this array field (we only need to know the field changed)
  const hasUpdate = updates.length > 0
  const dedupedUpdates: FieldUpdate[] = hasUpdate
    ? [{ contactId, googleResourceName, fieldPath: fieldName, newValue: newArray }]
    : []

  return { newArray, updates: dedupedUpdates, conflicts }
}

// ---------------------------------------------------------------------------
// Scalar fields list
// ---------------------------------------------------------------------------

type ScalarKey = keyof Pick<
  NormalizedContact,
  | 'displayName'
  | 'givenName'
  | 'familyName'
  | 'middleName'
  | 'honorificPrefix'
  | 'honorificSuffix'
  | 'phoneticGiven'
  | 'phoneticFamily'
  | 'nickname'
  | 'notesMd'
  | 'locale'
  | 'gender'
  | 'occupation'
  | 'photoUrl'
  | 'photoContentHash'
>

const SCALAR_FIELDS: ScalarKey[] = [
  'displayName',
  'givenName',
  'familyName',
  'middleName',
  'honorificPrefix',
  'honorificSuffix',
  'phoneticGiven',
  'phoneticFamily',
  'nickname',
  'notesMd',
  'locale',
  'gender',
  'occupation',
]

// ---------------------------------------------------------------------------
// Photo merge (spec §6.4)
// ---------------------------------------------------------------------------

function mergePhoto(
  ours: NormalizedContact,
  base: NormalizedContact | null,
  theirs: NormalizedContact,
  contactId: string,
  now: string,
): { update: FieldUpdate | null; conflict: ConflictRecord | null } {
  const oursHash = ours.photoContentHash
  const baseHash = base?.photoContentHash ?? null
  const theirsHash = theirs.photoContentHash

  const oursEqBase = deepEqual(oursHash, baseHash)
  const theirsEqBase = deepEqual(theirsHash, baseHash)

  if (oursEqBase && theirsEqBase) {
    return { update: null, conflict: null }
  }
  if (oursEqBase && !theirsEqBase) {
    // Download theirs, replace avatars row, update avatar_hash
    return {
      update: {
        contactId,
        googleResourceName: theirs.googleResourceName,
        fieldPath: 'photos[0]',
        newValue: theirs.photoUrl,
      },
      conflict: null,
    }
  }
  if (!oursEqBase && theirsEqBase) {
    // Keep ours
    return { update: null, conflict: null }
  }
  // Both changed from base
  if (deepEqual(oursHash, theirsHash)) {
    // Same change on both sides — apply theirs (no-op effectively, update base)
    return {
      update: {
        contactId,
        googleResourceName: theirs.googleResourceName,
        fieldPath: 'photos[0]',
        newValue: theirs.photoUrl,
      },
      conflict: null,
    }
  }
  // Different change — conflict
  return {
    update: null,
    conflict: {
      contactId,
      googleResourceName: theirs.googleResourceName,
      fieldPath: 'photos[0]',
      baseValueJson: JSON.stringify(baseHash),
      googleValueJson: JSON.stringify(theirsHash),
      localValueJson: JSON.stringify(oursHash),
      detectedAt: now,
    },
  }
}

// ---------------------------------------------------------------------------
// Three-way merge for one contact
// ---------------------------------------------------------------------------

interface MergeOneResult {
  cleanUpdates: FieldUpdate[]
  conflicts: ConflictRecord[]
}

function mergeOne(
  oursContact: NormalizedContact,
  baseContact: NormalizedContact | null,
  theirsContact: NormalizedContact,
  contactId: string,
  now: string,
): MergeOneResult {
  const cleanUpdates: FieldUpdate[] = []
  const conflicts: ConflictRecord[] = []
  const rn = theirsContact.googleResourceName

  // --- Scalar fields (spec §6.2) ---
  for (const field of SCALAR_FIELDS) {
    const oursVal: unknown = oursContact[field]
    const baseVal: unknown = baseContact ? baseContact[field] : undefined
    const theirsVal: unknown = theirsContact[field]

    const result = mergeScalar(field, oursVal, baseVal, theirsVal)

    if (result === 'apply-theirs') {
      if (!deepEqual(oursVal, theirsVal)) {
        cleanUpdates.push({
          contactId,
          googleResourceName: rn,
          fieldPath: field,
          newValue: theirsVal,
        })
      }
    } else if (result === 'conflict') {
      conflicts.push({
        contactId,
        googleResourceName: rn,
        fieldPath: field,
        baseValueJson: baseContact ? JSON.stringify(baseContact[field]) : null,
        googleValueJson: JSON.stringify(theirsContact[field]),
        localValueJson: JSON.stringify(oursContact[field]),
        detectedAt: now,
      })
    }
    // 'noop' or 'keep-ours' — no action
  }

  // --- userDefined (treat as scalar — full object compare) ---
  {
    const oursVal: unknown = oursContact.userDefined
    const baseVal: unknown = baseContact ? baseContact.userDefined : undefined
    const theirsVal: unknown = theirsContact.userDefined
    const result = mergeScalar('userDefined', oursVal, baseVal, theirsVal)
    if (result === 'apply-theirs') {
      if (!deepEqual(oursVal, theirsVal)) {
        cleanUpdates.push({
          contactId,
          googleResourceName: rn,
          fieldPath: 'userDefined',
          newValue: theirsVal,
        })
      }
    } else if (result === 'conflict') {
      conflicts.push({
        contactId,
        googleResourceName: rn,
        fieldPath: 'userDefined',
        baseValueJson: baseContact ? JSON.stringify(baseContact.userDefined) : null,
        googleValueJson: JSON.stringify(theirsContact.userDefined),
        localValueJson: JSON.stringify(oursContact.userDefined),
        detectedAt: now,
      })
    }
  }

  // --- Array fields (spec §6.3) ---

  const phoneResult = mergeArray(
    'phones',
    oursContact.phones,
    baseContact?.phones ?? [],
    theirsContact.phones,
    phoneKey,
    contactId,
    rn,
    now,
  )
  cleanUpdates.push(...phoneResult.updates)
  conflicts.push(...phoneResult.conflicts)

  const emailResult = mergeArray(
    'emails',
    oursContact.emails,
    baseContact?.emails ?? [],
    theirsContact.emails,
    emailKey,
    contactId,
    rn,
    now,
  )
  cleanUpdates.push(...emailResult.updates)
  conflicts.push(...emailResult.conflicts)

  const addrResult = mergeArray(
    'addresses',
    oursContact.addresses,
    baseContact?.addresses ?? [],
    theirsContact.addresses,
    addressKey,
    contactId,
    rn,
    now,
  )
  cleanUpdates.push(...addrResult.updates)
  conflicts.push(...addrResult.conflicts)

  const eventResult = mergeArray(
    'events',
    oursContact.events,
    baseContact?.events ?? [],
    theirsContact.events,
    eventKey,
    contactId,
    rn,
    now,
  )
  cleanUpdates.push(...eventResult.updates)
  conflicts.push(...eventResult.conflicts)

  const orgResult = mergeArray(
    'organizations',
    oursContact.organizations,
    baseContact?.organizations ?? [],
    theirsContact.organizations,
    orgKey,
    contactId,
    rn,
    now,
  )
  cleanUpdates.push(...orgResult.updates)
  conflicts.push(...orgResult.conflicts)

  const urlResult = mergeArray(
    'urls',
    oursContact.urls,
    baseContact?.urls ?? [],
    theirsContact.urls,
    urlKey,
    contactId,
    rn,
    now,
  )
  cleanUpdates.push(...urlResult.updates)
  conflicts.push(...urlResult.conflicts)

  const imResult = mergeArray(
    'imClients',
    oursContact.imClients,
    baseContact?.imClients ?? [],
    theirsContact.imClients,
    imKey,
    contactId,
    rn,
    now,
  )
  cleanUpdates.push(...imResult.updates)
  conflicts.push(...imResult.conflicts)

  const birthdayResult = mergeArray(
    'birthdays',
    oursContact.birthdays,
    baseContact?.birthdays ?? [],
    theirsContact.birthdays,
    birthdayKey,
    contactId,
    rn,
    now,
  )
  cleanUpdates.push(...birthdayResult.updates)
  conflicts.push(...birthdayResult.conflicts)

  const relationResult = mergeArray(
    'relations',
    oursContact.relations,
    baseContact?.relations ?? [],
    theirsContact.relations,
    relationKey,
    contactId,
    rn,
    now,
  )
  cleanUpdates.push(...relationResult.updates)
  conflicts.push(...relationResult.conflicts)

  // --- Photo (spec §6.4) ---
  const photoResult = mergePhoto(oursContact, baseContact, theirsContact, contactId, now)
  if (photoResult.update) cleanUpdates.push(photoResult.update)
  if (photoResult.conflict) conflicts.push(photoResult.conflict)

  return { cleanUpdates, conflicts }
}

// ---------------------------------------------------------------------------
// Main export: computeChangeset
// ---------------------------------------------------------------------------

/**
 * Compute a full Changeset by performing three-way merge for every contact.
 * Pure function — no I/O, no async, no mutation of inputs.
 * Idempotent: same inputs always produce the same Changeset.
 */
export function computeChangeset(input: ComputeChangesetInput): Changeset {
  const {
    runId,
    snapshots,
    theirs,
    deletedRemotely,
    ours,
    theirLabels,
    theirLabelMemberships,
    now,
  } = input

  // Build lookup maps for ours keyed by googleResourceName
  const oursMap = new Map<string, NormalizedContact>()
  for (const c of ours) {
    oursMap.set(c.googleResourceName, c)
  }

  // We need contactId for FieldUpdate / ConflictRecord.
  // NormalizedContact doesn't carry a local DB contactId (it's a Google shape).
  // We use googleResourceName as the contactId surrogate here; the applier
  // will resolve it to the real contacts.id when writing to DB.
  // For existing contacts (in oursMap) we use googleResourceName as stable key.

  const cleanInserts: NormalizedContact[] = []
  const cleanUpdates: FieldUpdate[] = []
  const cleanDeletes: string[] = [] // googleResourceName (applier maps to contactId)
  const conflicts: ConflictRecord[] = []
  // Track the current Google NormalizedContact for each contact that has cleanUpdates.
  const updatedNormalized = new Map<string, NormalizedContact>()

  // --- Process theirs (insertions + updates) ---
  for (const theirsContact of theirs) {
    const rn = theirsContact.googleResourceName
    const snapshot = snapshots.get(rn) ?? null
    const oursContact = oursMap.get(rn) ?? null

    if (!oursContact && !snapshot) {
      // Brand new contact never seen locally → INSERT
      cleanInserts.push(theirsContact)
      continue
    }

    if (!oursContact && snapshot) {
      // Was in snapshot (previously pulled) but locally deleted.
      if (deepEqual(theirsContact, snapshot)) {
        // Remote unchanged since we deleted it — confirmed deletion on both sides, no-op
      } else {
        // Remote changed after local deletion — conflict
        conflicts.push({
          contactId: rn,
          googleResourceName: rn,
          fieldPath: '<X>:deleted_locally_but_remote_changed',
          baseValueJson: JSON.stringify(snapshot),
          googleValueJson: JSON.stringify(theirsContact),
          localValueJson: JSON.stringify(null),
          detectedAt: now,
        })
      }
      continue
    }

    if (oursContact) {
      // Standard three-way merge (with or without snapshot as base)
      const { cleanUpdates: cu, conflicts: cf } = mergeOne(
        oursContact,
        snapshot, // may be null if orphaned local Google-id (unusual case)
        theirsContact,
        rn, // use resourceName as contactId surrogate; applier resolves
        now,
      )
      cleanUpdates.push(...cu)
      conflicts.push(...cf)
      // Record theirs for applier snapshot upsert (only if there are actual updates)
      if (cu.length > 0) {
        updatedNormalized.set(rn, theirsContact)
      }
    }
  }

  // --- Process deletions (spec §6.6) ---
  for (const rn of deletedRemotely) {
    const oursContact = oursMap.get(rn) ?? null
    const snapshot = snapshots.get(rn) ?? null

    if (!oursContact) {
      // Already not in ours — nothing to delete, skip
      continue
    }

    if (snapshot && deepEqual(oursContact, snapshot)) {
      // Ours equals snapshot — clean deletion
      cleanDeletes.push(rn)
    } else {
      // Ours differs from snapshot (or no snapshot) — conflict
      conflicts.push({
        contactId: rn,
        googleResourceName: rn,
        fieldPath: '__deletion__',
        baseValueJson: snapshot ? JSON.stringify(snapshot) : null,
        googleValueJson: null,
        localValueJson: JSON.stringify(oursContact),
        detectedAt: now,
      })
    }
  }

  // --- Labels (spec §6.5 / INV-4): full-replace, no merge ---
  // memberships from Google use resourceName as key; callers must map to contactId
  const labels = {
    full: theirLabels,
    memberships: theirLabelMemberships,
  }

  // --- Sort all outputs for deterministic ordering (idempotency, spec §6.8) ---
  cleanInserts.sort((a, b) => a.googleResourceName.localeCompare(b.googleResourceName))
  cleanUpdates.sort((a, b) => {
    const rnCmp = a.googleResourceName.localeCompare(b.googleResourceName)
    return rnCmp !== 0 ? rnCmp : a.fieldPath.localeCompare(b.fieldPath)
  })
  cleanDeletes.sort((a, b) => a.localeCompare(b))
  conflicts.sort((a, b) => {
    const rnCmp = a.googleResourceName.localeCompare(b.googleResourceName)
    return rnCmp !== 0 ? rnCmp : a.fieldPath.localeCompare(b.fieldPath)
  })

  return {
    runId,
    cleanInserts,
    cleanUpdates,
    cleanDeletes,
    conflicts,
    labels,
    updatedNormalized,
    counts: {
      inserts: cleanInserts.length,
      updates: cleanUpdates.length,
      deletes: cleanDeletes.length,
      conflicts: conflicts.length,
    },
  }
}
