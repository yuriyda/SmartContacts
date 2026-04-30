/**
 * sync.ts — Decentralized state-based sync engine for Smart Contacts.
 *
 * Core idea: each device computes a delta for another device by comparing its
 * current DB state against the target device's vector clock. No sync_log
 * dependency for transport — sync_log is only a local UI convenience.
 *
 * contacts.device_id tracks who last modified each contact.
 * contacts.lamport_ts tracks when (in that device's logical time).
 * vector_clock tracks what each device knows about every other device.
 *
 * Full export  = computeSyncPackage(db, {})       — empty VC = send everything.
 * Delta export = computeSyncPackage(db, remoteVC) — only what remote hasn't seen.
 *
 * Editing rules:
 *  - All functions receive a DbAdapter (execute/select) — no direct SQLite import.
 *  - Must stay transport-agnostic (no Drive / filesystem logic here).
 *  - No nested db.transaction() calls — importSyncPackage uses ONE outer tx for
 *    all writes, then a separate tx for runLookupGc.
 *  - No `any` except JSON.parse call-sites (type-asserted immediately).
 *  - Column list for CONTACT_INSERT_IGN must stay in sync with COLUMNS in contactsRepo.ts.
 */

import type { Contact, CustomFieldDef, SyncPackage, SyncRequest, VectorClock } from '../types'
import type { DbAdapter } from '../db/adapter'
import { contactToRow, rowToContact } from '../db/contactRow'
import { runLookupGc } from '../db/lookupGc'

// ---------------------------------------------------------------------------
// Contact INSERT column list — keep in sync with COLUMNS in contactsRepo.ts
// ---------------------------------------------------------------------------

// NOTE: This list must match the COLUMNS constant in contactsRepo.ts exactly.
// If contactsRepo.ts adds/removes a column, update this list too.
const CONTACT_COLUMNS = [
  'id',
  'given_name',
  'family_name',
  'middle_name',
  'honorific_prefix',
  'honorific_suffix',
  'phonetic_given',
  'phonetic_family',
  'display_name',
  'nickname',
  'phones',
  'emails',
  'addresses',
  'events',
  'organizations',
  'urls',
  'im_clients',
  'relations_external',
  'groups',
  'notes_md',
  'user_defined',
  'locale',
  'gender',
  'occupation',
  'tags',
  'relations_internal',
  'custom_fields',
  'last_contacted_at',
  'preferred_channel',
  'priority',
  'social_detected',
  'reminders',
  'google_resource_name',
  'google_etag',
  'google_last_synced_at',
  'avatar_hash',
  'created_at',
  'updated_at',
  'deleted_at',
  'lamport_ts',
  'device_id',
] as const

type ContactColumnName = (typeof CONTACT_COLUMNS)[number]

const CONTACT_COL_LIST = CONTACT_COLUMNS.join(', ')
const CONTACT_PLACEHOLDERS = CONTACT_COLUMNS.map(() => '?').join(', ')

/** INSERT OR IGNORE so we never overwrite a newer local row on race conditions. */
const CONTACT_INSERT_IGN = `INSERT OR IGNORE INTO contacts (${CONTACT_COL_LIST}) VALUES (${CONTACT_PLACEHOLDERS})`

/** Extract ordered column values from a contact row for binding to CONTACT_INSERT_IGN. */
function contactRowParams(row: Record<string, unknown>): unknown[] {
  return CONTACT_COLUMNS.map((c: ContactColumnName) =>
    Object.prototype.hasOwnProperty.call(row, c) ? (row[c] ?? null) : null,
  )
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

/**
 * Determine whether an incoming record should replace the local record.
 * Incoming wins iff its lamport_ts is strictly greater, OR lamport_ts is equal
 * and its device_id is lexicographically greater (deterministic tie-break so all
 * devices converge on the same winner).
 *
 * Exported for testing; used internally by importSyncPackage.
 */
export function shouldReplace(
  incomingLts: number | null | undefined,
  localLts: number | null | undefined,
  incomingDid: string | null | undefined,
  localDid: string | null | undefined,
): boolean {
  const inL = incomingLts ?? 0
  const loL = localLts ?? 0
  if (inL > loL) return true
  if (inL < loL) return false
  return (incomingDid ?? '') > (localDid ?? '')
}

// ---------------------------------------------------------------------------
// Lamport bump helper (inline pattern; NOT bumpLamport from contactActions.ts)
// ---------------------------------------------------------------------------

/**
 * Ensure the local device's Lamport counter is at least `target`.
 * Uses MAX so a higher local counter is never clobbered.
 * Must be called OUTSIDE any transaction (opens its own).
 */
async function bumpLocalCounterTo(
  db: DbAdapter,
  localDeviceId: string,
  target: number,
): Promise<void> {
  await db.execute(
    `INSERT INTO vector_clock (device_id, counter) VALUES (?, ?)
     ON CONFLICT(device_id) DO UPDATE SET counter = MAX(counter, ?)`,
    [localDeviceId, target, target],
  )
}

// ---------------------------------------------------------------------------
// Phase 1: build sync request
// ---------------------------------------------------------------------------

/**
 * Build a sync request — a lightweight message that tells the responder who we
 * are and what we already know (our vector clock). The responder uses this to
 * compute a delta package for us.
 */
export async function buildSyncRequest(db: DbAdapter): Promise<SyncRequest> {
  const devRows = await db.select<{ value: string }>("SELECT value FROM meta WHERE key='device_id'")
  const localDeviceId = devRows[0]?.value ?? null
  const vcRows = await db.select<{ device_id: string; counter: number }>(
    'SELECT device_id, counter FROM vector_clock',
  )
  const localVC: VectorClock = Object.fromEntries(vcRows.map((r) => [r.device_id, r.counter]))

  return {
    type: 'sync_request',
    deviceId: localDeviceId,
    vectorClock: localVC,
  }
}

// ---------------------------------------------------------------------------
// Phase 2: compute sync package
// ---------------------------------------------------------------------------

/**
 * Build a sync package containing everything the target device hasn't seen.
 * targetVC: the remote device's vector clock, e.g. { DEVICE_A: 10, DEVICE_B: 5 }.
 * Empty targetVC ({}) = full export (recovery mode).
 *
 * Tombstones (deleted_at set) are included so deletions propagate.
 * Lookup tables (tags_index / groups_index) are NOT in the package — they are
 * derived per device and rebuilt locally on import.
 */
export async function computeSyncPackage(
  db: DbAdapter,
  targetVC: VectorClock = {},
): Promise<SyncPackage> {
  const devRows = await db.select<{ value: string }>("SELECT value FROM meta WHERE key='device_id'")
  const localDeviceId = devRows[0]?.value ?? null

  const vcRows = await db.select<{ device_id: string; counter: number }>(
    'SELECT device_id, counter FROM vector_clock',
  )
  const localVC: VectorClock = Object.fromEntries(vcRows.map((r) => [r.device_id, r.counter]))

  // A contact is "unseen" by target iff its lamport_ts > targetVC[device_id] ?? 0.
  // Unknown origin (no device_id) → always send.
  const allContacts = await db.select<Record<string, unknown>>('SELECT * FROM contacts')
  const contactsToSend = allContacts.filter((row) => {
    const did = row['device_id'] as string | null | undefined
    if (!did) return true
    const targetKnows = targetVC[did] ?? 0
    return ((row['lamport_ts'] as number) ?? 0) > targetKnows
  })

  // custom_field_defs: same unseen filter. Include soft-deleted so deletions propagate.
  const allDefs = await db.select<Record<string, unknown>>('SELECT * FROM custom_field_defs')
  const defsToSend = allDefs.filter((row) => {
    const did = row['device_id'] as string | null | undefined
    if (!did) return true
    const targetKnows = targetVC[did] ?? 0
    return ((row['lamport_ts'] as number) ?? 0) > targetKnows
  })

  return {
    type: 'sync_package',
    deviceId: localDeviceId,
    vectorClock: localVC,
    contacts: contactsToSend.map((row) => _rowToContact(row)),
    customFieldDefs: defsToSend.map((row) => _rowToDef(row)),
    // avatars: TODO P5 — avatar blob transport not yet implemented.
    // settings: TODO P5 — per-key LWW not yet implemented; undefined on export.
  }
}

// ---------------------------------------------------------------------------
// Phase 3: import sync package
// ---------------------------------------------------------------------------

/**
 * Apply an incoming sync package to our DB. Returns:
 *  - stats: counts of applied / skipped / outdated records.
 *  - response: a package computed for the sender (what they haven't seen from us).
 *
 * All writes happen in a single db.transaction(). After commit, lookupGc runs
 * in a separate transaction.
 *
 * avatars: field is accepted but ignored until P5.
 * settings: simple INSERT OR REPLACE merge (no per-key LWW yet — see TODO P5).
 */
export async function importSyncPackage(
  db: DbAdapter,
  pkg: SyncPackage,
): Promise<{
  stats: { applied: number; skipped: number; outdated: number }
  response: SyncPackage
}> {
  // TODO P5: pkg.avatars — avatar blobs are accepted but ignored until P5.
  // TODO P5: pkg.settings — full per-key LWW by (lamport, deviceId) not yet implemented.
  //   For now: simple INSERT OR REPLACE merge (last writer wins globally).

  const { deviceId: remoteDeviceId, vectorClock: remoteVC, contacts, customFieldDefs } = pkg
  void remoteDeviceId

  let applied = 0
  let skipped = 0
  let outdated = 0

  // All writes in one transaction to keep the DB consistent.
  await db.transaction(async (tx) => {
    // --- Merge vector clock ---------------------------------------------------
    if (remoteVC) {
      for (const [devId, counter] of Object.entries(remoteVC)) {
        await tx.execute(
          `INSERT INTO vector_clock (device_id, counter) VALUES (?, ?)
           ON CONFLICT(device_id) DO UPDATE SET counter = MAX(counter, excluded.counter)`,
          [devId, counter],
        )
      }
    }

    // --- Import contacts -----------------------------------------------------
    if (contacts && contacts.length > 0) {
      const localDevRows = await tx.select<{ value: string }>(
        "SELECT value FROM meta WHERE key='device_id'",
      )
      const localDeviceId = localDevRows[0]?.value ?? null
      let maxImportedLts = 0

      for (const contact of contacts) {
        const lts = contact.lamportTs ?? 0
        maxImportedLts = Math.max(maxImportedLts, lts)

        const existing = await tx.select<{ lamport_ts: number; device_id: string | null }>(
          'SELECT lamport_ts, device_id FROM contacts WHERE id = ?',
          [contact.id],
        )

        if (existing.length === 0) {
          // New contact — insert even if from same device (could be restore/recovery).
          const row = contactToRow(contact)
          const params = contactRowParams(row)
          await tx.execute(CONTACT_INSERT_IGN, params)
          applied++
        } else {
          const local = existing[0]!
          if (shouldReplace(lts, local.lamport_ts, contact.deviceId, local.device_id)) {
            // Incoming wins: strictly newer, or equal lamport with lexicographically higher deviceId.
            await _fullUpdateContact(tx, contact)
            applied++
          } else if (
            lts === local.lamport_ts &&
            (contact.deviceId ?? '') === (local.device_id ?? '')
          ) {
            // Exact same version — skip (our own record bounced back, or duplicate).
            skipped++
          } else if (
            lts === (local.lamport_ts ?? 0) &&
            (contact.deviceId ?? '') < (local.device_id ?? '')
          ) {
            // Equal lamport, local device wins tie-break — skip.
            skipped++
          } else {
            // Incoming is older — local wins.
            outdated++
          }
        }
      }

      // Lamport clock merge: ensure local counter >= max imported timestamp.
      // Without this, local edits after import could get a lamportTs lower than
      // an imported value, causing the edit to be rejected as "older" on next sync.
      if (localDeviceId !== null && maxImportedLts > 0) {
        await tx.execute(
          `INSERT INTO vector_clock (device_id, counter) VALUES (?, ?)
           ON CONFLICT(device_id) DO UPDATE SET counter = MAX(counter, ?)`,
          [localDeviceId, maxImportedLts, maxImportedLts],
        )
      }
    }

    // --- Import custom field defs --------------------------------------------
    if (customFieldDefs && customFieldDefs.length > 0) {
      const localDevRows = await tx.select<{ value: string }>(
        "SELECT value FROM meta WHERE key='device_id'",
      )
      const localDeviceId = localDevRows[0]?.value ?? null
      let maxImportedLts = 0

      for (const def of customFieldDefs) {
        const lts = def.lamportTs ?? 0
        maxImportedLts = Math.max(maxImportedLts, lts)

        const existing = await tx.select<{ lamport_ts: number; device_id: string | null }>(
          'SELECT lamport_ts, device_id FROM custom_field_defs WHERE id = ?',
          [def.id],
        )

        const optionsJson =
          def.type === 'select' ? JSON.stringify((def as { options: string[] }).options) : null

        if (existing.length === 0) {
          // New def — insert.
          await tx.execute(
            `INSERT OR IGNORE INTO custom_field_defs
             (id, name, type, options, created_at, updated_at, deleted_at, lamport_ts, device_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              def.id,
              def.name,
              def.type,
              optionsJson,
              def.createdAt,
              def.updatedAt,
              def.deletedAt ?? null,
              lts,
              def.deviceId,
            ],
          )
          applied++
        } else {
          const local = existing[0]!
          if (shouldReplace(lts, local.lamport_ts, def.deviceId, local.device_id)) {
            // Incoming wins.
            await tx.execute(
              `UPDATE custom_field_defs
               SET name=?, type=?, options=?, updated_at=?, deleted_at=?, lamport_ts=?, device_id=?
               WHERE id=?`,
              [
                def.name,
                def.type,
                optionsJson,
                def.updatedAt,
                def.deletedAt ?? null,
                lts,
                def.deviceId,
                def.id,
              ],
            )
            applied++
          } else if (lts < (local.lamport_ts ?? 0)) {
            outdated++
          } else {
            skipped++
          }
        }
      }

      // Bump local Lamport counter after defs import.
      if (localDeviceId !== null && maxImportedLts > 0) {
        await tx.execute(
          `INSERT INTO vector_clock (device_id, counter) VALUES (?, ?)
           ON CONFLICT(device_id) DO UPDATE SET counter = MAX(counter, ?)`,
          [localDeviceId, maxImportedLts, maxImportedLts],
        )
      }
    }

    // --- Merge settings (TODO P5: proper per-key LWW by (lamport, deviceId)) ---
    if (pkg.settings) {
      for (const [key, value] of Object.entries(pkg.settings)) {
        await tx.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [key, value])
      }
    }
  })

  // After commit: rebuild lookup tables (tags_index, groups_index) in their own tx.
  // runLookupGc requires an open tx context.
  await db.transaction(async (tx) => {
    await runLookupGc(tx)
  })

  // Bump local Lamport counter for any maxImportedLts that may have exceeded
  // our vector_clock (edge case when contacts array was empty but remoteVC was higher).
  const devRows = await db.select<{ value: string }>("SELECT value FROM meta WHERE key='device_id'")
  const localDeviceId = devRows[0]?.value
  if (localDeviceId && remoteVC) {
    const maxRemoteLts = Math.max(0, ...Object.values(remoteVC))
    if (maxRemoteLts > 0) {
      await bumpLocalCounterTo(db, localDeviceId, maxRemoteLts)
    }
  }

  // Compute response package: what does the sender need from us?
  const response = await computeSyncPackage(db, remoteVC ?? {})

  return {
    stats: { applied, skipped, outdated },
    response,
  }
}

// ---------------------------------------------------------------------------
// Internal row helpers
// ---------------------------------------------------------------------------

/**
 * Decode a raw DB row from `contacts` into a Contact.
 * Thin wrapper around the shared rowToContact from contactRow.ts.
 */
function _rowToContact(row: Record<string, unknown>): Contact {
  return rowToContact(row)
}

/**
 * Full update of a contact row from incoming data (all fields overwritten).
 * Runs on an already-open tx.
 */
async function _fullUpdateContact(tx: DbAdapter, c: Contact): Promise<void> {
  const row = contactToRow(c)
  // Build SET clause from CONTACT_COLUMNS (skip 'id' — it's the WHERE predicate).
  const sets = CONTACT_COLUMNS.filter((col) => col !== 'id').map((col) => `${col} = ?`)
  const vals: unknown[] = CONTACT_COLUMNS.filter((col) => col !== 'id').map(
    (col: ContactColumnName) =>
      Object.prototype.hasOwnProperty.call(row, col) ? (row[col] ?? null) : null,
  )
  vals.push(c.id)
  await tx.execute(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`, vals)
}

/**
 * Decode a raw DB row from `custom_field_defs` into a CustomFieldDef.
 */
function _rowToDef(row: Record<string, unknown>): CustomFieldDef {
  const base = {
    id: row['id'] as string,
    name: row['name'] as string,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    deletedAt: (row['deleted_at'] as string | null) ?? null,
    lamportTs: row['lamport_ts'] as number,
    deviceId: row['device_id'] as string,
  }
  const type = row['type'] as string
  if (type === 'select') {
    const optionsRaw = row['options']
    const options = optionsRaw ? (JSON.parse(optionsRaw as string) as string[]) : []
    return { ...base, type: 'select', options }
  }
  return { ...base, type: type as 'text' | 'date' | 'number' | 'url' | 'boolean' }
}
