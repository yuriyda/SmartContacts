// Applier — applies a Changeset atomically to the local DB in one transaction.
// RO-INVARIANT: INV-2 (changeset applied as a single atomic transaction), INV-6 (only after dry-run + user confirm).
//
// Rules:
//  - ALL inserts/updates/deletes happen inside a single db.transaction() call.
//  - NO nested db.transaction() calls — repos that use their own transaction are re-instantiated
//    with `tx` as the db, or SQL is called directly on `tx`.
//  - LabelRepo.replaceAll and replaceMembershipsForContact wrap in their own transactions, so
//    labels are applied via direct SQL on `tx` to avoid nesting.
//  - ConflictRepo.insertPending does NOT wrap in a transaction — it is safe to rebind with tx.
//  - SnapshotRepo.upsert does NOT wrap in a transaction — it is safe to rebind with tx.
//  - SyncLogRepo.append does NOT wrap in a transaction — the apply_failed log is written outside
//    the failed transaction (after rollback) so the log itself is NOT inside the rolled-back tx.
//  - No `any` types.

import { ulid } from '../../../ulid'
import type { DbAdapter } from '../../../db/adapter'
import { SnapshotRepo } from './snapshot-repo'
import { ConflictRepo } from './conflict-repo'
import type { NewConflict } from './conflict-repo'
import type { SyncLogRepo } from './sync-log-repo'
import type { GoogleLabelRow } from './label-repo'
import type { NormalizedContact } from './types'

// ---------------------------------------------------------------------------
// Minimal contact interface required by Applier (avoids hard dependency on
// the concrete contactsRepo factory which bundles Lamport-clock logic).
// ---------------------------------------------------------------------------

export interface ContactsRepoLike {
  /** Lookup a contact by Google resource name; returns null if not found. */
  listByGoogleResourceName(resourceName: string): Promise<{ id: string } | null>
}

// ---------------------------------------------------------------------------
// Changeset — the full shape produced by differ.ts (T12).
// Defined here so applier.ts has no circular dependency on differ.ts at T13.
// differ.ts MUST export a compatible type when implemented.
// ---------------------------------------------------------------------------

/** A field-level update to apply to an existing contact. */
export interface FieldUpdate {
  /** SQL column name on the `contacts` table, e.g. 'display_name'. */
  columnName: string
  /** New serialized value: TEXT (string), JSON-encoded array, or null. */
  newValue: string | null
}

/** One clean update: no conflict, apply theirs. */
export interface CleanUpdate {
  /** The local contact row id. */
  contactId: string
  googleResourceName: string
  /** Normalized contact with all current Google values (used to update snapshot). */
  normalized: NormalizedContact
  /** Specific field-level changes to apply to the contacts row. */
  fieldUpdates: FieldUpdate[]
}

/** Conflict entry to be inserted into sync_conflicts. */
export interface ConflictEntry {
  contactId: string
  googleResourceName: string
  fieldPath: string
  baseValueJson: string | null
  googleValueJson: string | null
  localValueJson: string
  detectedAt: string
}

/** Labels section of the Changeset. */
export interface ChangesetLabels {
  /** Full replacement set for google_labels table. */
  full: GoogleLabelRow[]
  /** Per-contact label membership: contactId → [labelResourceName, ...]. */
  memberships: Map<string, string[]>
}

/**
 * Full Changeset as produced by differ.ts.
 * All operations are pre-classified; no DB reads required during apply.
 */
export interface Changeset {
  /** Unique identifier for this sync run (UUID). */
  runId: string
  /** New contacts to insert (no local row exists). */
  cleanInserts: NormalizedContact[]
  /** Existing contacts to update (clean merge, no conflict). */
  cleanUpdates: CleanUpdate[]
  /** Google resource names of contacts to delete (cascades to related tables). */
  cleanDeletes: string[]
  /** Field-level conflicts to queue. */
  conflicts: ConflictEntry[]
  /** Google labels and memberships (always full-replaced). */
  labels: ChangesetLabels
}

// ---------------------------------------------------------------------------
// Public result + deps
// ---------------------------------------------------------------------------

export interface ApplyResult {
  appliedCount: number
  conflictCount: number
  durationMs: number
}

export interface ApplierDeps {
  db: DbAdapter
  snapshotRepo: SnapshotRepo
  conflictRepo: ConflictRepo
  syncLogRepo: SyncLogRepo
  contactsRepo: ContactsRepoLike
}

// ---------------------------------------------------------------------------
// Contacts table column list (mirrors contactsRepo.ts COLUMNS).
// Used to build the INSERT for cleanInserts.
// ---------------------------------------------------------------------------

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
  'protected',
  'hidden',
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

type ContactColumn = (typeof CONTACT_COLUMNS)[number]

const CONTACT_PLACEHOLDERS = CONTACT_COLUMNS.map(() => '?').join(', ')
const CONTACT_COL_LIST = CONTACT_COLUMNS.join(', ')
const CONTACT_UPSERT_SQL = `INSERT OR REPLACE INTO contacts (${CONTACT_COL_LIST}) VALUES (${CONTACT_PLACEHOLDERS})`

/** Build ordered params for the CONTACT_UPSERT_SQL from a partial row object. */
function contactParams(row: Partial<Record<ContactColumn, unknown>>): unknown[] {
  return CONTACT_COLUMNS.map((c) =>
    Object.prototype.hasOwnProperty.call(row, c) ? (row[c] ?? null) : null,
  )
}

/** Encode an optional string field to string | null. */
function encText(v: string | undefined): string | null {
  return v ?? null
}

/** Encode an optional array field to JSON string | null. */
function encArray(v: unknown[] | undefined): string | null {
  return v === undefined ? null : JSON.stringify(v)
}

/** Encode an optional record field to JSON string | null. */
function encRecord(v: Record<string, string> | undefined): string | null {
  return v === undefined ? null : JSON.stringify(v)
}

/** Build a contacts row from a NormalizedContact for INSERT. */
function normalizedToContactRow(
  id: string,
  c: NormalizedContact,
  now: string,
  lamportTs: number,
  deviceId: string,
): Partial<Record<ContactColumn, unknown>> {
  return {
    id,
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
    user_defined: encRecord(c.userDefined),
    locale: encText(c.locale),
    gender: encText(c.gender),
    occupation: encText(c.occupation),
    google_resource_name: c.googleResourceName,
    google_etag: c.etag,
    google_last_synced_at: now,
    created_at: now,
    updated_at: now,
    lamport_ts: lamportTs,
    device_id: deviceId,
    // Intentionally null for Google-imported contacts (no local metadata):
    relations_external: null,
    groups: null,
    notes_md: null,
    tags: null,
    relations_internal: null,
    custom_fields: null,
    last_contacted_at: null,
    preferred_channel: null,
    priority: null,
    protected: 0,
    hidden: 0,
    social_detected: null,
    reminders: null,
    avatar_hash: c.photoContentHash,
    deleted_at: null,
  }
}

// ---------------------------------------------------------------------------
// Applier
// ---------------------------------------------------------------------------

/** Device ID used when inserting new Google contacts (no local device owns them). */
const GOOGLE_DEVICE_ID = 'google_sync'

export class Applier {
  constructor(private deps: ApplierDeps) {}

  async apply(changeset: Changeset): Promise<ApplyResult> {
    const start = performance.now()
    let appliedCount = 0
    let conflictCount = 0

    try {
      await this.deps.db.transaction(async (tx: DbAdapter) => {
        const now = new Date().toISOString()

        // -- (a) cleanInserts: insert new contact rows + snapshots --
        for (const normalized of changeset.cleanInserts) {
          // Check for an existing row with the same google_resource_name (idempotency).
          const existing = await tx.select<{ id: string }>(
            'SELECT id FROM contacts WHERE google_resource_name = ?',
            [normalized.googleResourceName],
          )
          const id = existing[0]?.id ?? ulid()

          // Insert or replace contact row (lamportTs = 0 for Google-only contacts)
          const row = normalizedToContactRow(id, normalized, now, 0, GOOGLE_DEVICE_ID)
          await tx.execute(CONTACT_UPSERT_SQL, contactParams(row))

          // Insert snapshot
          const snapshotRepo = new SnapshotRepo(tx)
          await snapshotRepo.upsert({
            googleResourceName: normalized.googleResourceName,
            etag: normalized.etag,
            updateTime: normalized.updateTime,
            payloadJson: JSON.stringify(normalized),
            lastSyncedAt: now,
          })

          appliedCount++
        }

        // -- (b) cleanUpdates: update contacts + snapshots --
        for (const update of changeset.cleanUpdates) {
          // Apply each field change to the contacts row
          if (update.fieldUpdates.length > 0) {
            const setClauses = update.fieldUpdates.map((fu) => `${fu.columnName} = ?`).join(', ')
            const params: unknown[] = [
              ...update.fieldUpdates.map((fu) => fu.newValue),
              update.contactId,
            ]
            await tx.execute(
              `UPDATE contacts SET ${setClauses}, updated_at = ?, google_last_synced_at = ? WHERE id = ?`,
              [...params.slice(0, -1), now, now, update.contactId],
            )
          } else {
            // No field changes but snapshot still needs updating (e.g. etag changed only)
            await tx.execute(
              `UPDATE contacts SET google_last_synced_at = ?, updated_at = ? WHERE id = ?`,
              [now, now, update.contactId],
            )
          }

          // Upsert snapshot with latest normalized data
          const snapshotRepo = new SnapshotRepo(tx)
          await snapshotRepo.upsert({
            googleResourceName: update.googleResourceName,
            etag: update.normalized.etag,
            updateTime: update.normalized.updateTime,
            payloadJson: JSON.stringify(update.normalized),
            lastSyncedAt: now,
          })

          appliedCount++
        }

        // -- (c) cleanDeletes: delete contact rows (CASCADE handles related tables) --
        for (const resourceName of changeset.cleanDeletes) {
          await tx.execute('DELETE FROM contacts WHERE google_resource_name = ?', [resourceName])
          // Also explicitly delete snapshot (in case FK CASCADE not enabled)
          await tx.execute('DELETE FROM google_contact_snapshots WHERE google_resource_name = ?', [
            resourceName,
          ])
          appliedCount++
        }

        // -- (d) conflicts: insert pending conflict rows --
        const conflictRepo = new ConflictRepo(tx)
        const pendingRows: NewConflict[] = changeset.conflicts.map((c) => ({
          contactId: c.contactId,
          googleResourceName: c.googleResourceName,
          fieldPath: c.fieldPath,
          baseValueJson: c.baseValueJson,
          googleValueJson: c.googleValueJson,
          localValueJson: c.localValueJson,
          detectedAt: c.detectedAt,
        }))
        await conflictRepo.insertPending(pendingRows)
        conflictCount = changeset.conflicts.length

        // -- (e) labels: full-replace google_labels, then per-contact memberships --
        // NOTE: LabelRepo.replaceAll/replaceMembershipsForContact call db.transaction() internally.
        // To avoid nested transactions, we replicate their SQL directly on `tx`.
        await tx.execute('DELETE FROM google_labels')
        for (const label of changeset.labels.full) {
          await tx.execute(
            `INSERT INTO google_labels (resource_name, name, group_type, etag, last_synced_at)
             VALUES (?, ?, ?, ?, ?)`,
            [label.resourceName, label.name, label.groupType, label.etag, label.lastSyncedAt],
          )
        }
        for (const [contactId, labelResourceNames] of changeset.labels.memberships) {
          await tx.execute('DELETE FROM google_label_memberships WHERE contact_id = ?', [contactId])
          for (const resourceName of labelResourceNames) {
            await tx.execute(
              `INSERT INTO google_label_memberships (contact_id, label_resource_name)
               VALUES (?, ?)`,
              [contactId, resourceName],
            )
          }
        }

        // -- (f) final log: append apply_complete inside the transaction --
        // SyncLogRepo.append does not wrap in transaction, so it is safe to rebind to tx.
        const durationMsSoFar = performance.now() - start
        await tx.execute(
          `INSERT INTO google_contacts_sync_log (run_id, ts, event, level, payload_json)
           VALUES (?, ?, 'apply_complete', 'info', ?)`,
          [
            changeset.runId,
            new Date().toISOString(),
            JSON.stringify({ appliedCount, conflictCount, durationMs: durationMsSoFar }),
          ],
        )
      })
    } catch (err) {
      // Transaction rolled back — log failure outside the transaction
      const stack = err instanceof Error ? (err.stack ?? err.message) : String(err)
      const errMsg = err instanceof Error ? err.message : String(err)
      await this.deps.syncLogRepo.append({
        runId: changeset.runId,
        event: 'apply_failed',
        level: 'error',
        payload: { error: errMsg, stack },
      })
      throw err
    }

    const durationMs = performance.now() - start
    return { appliedCount, conflictCount, durationMs }
  }
}
