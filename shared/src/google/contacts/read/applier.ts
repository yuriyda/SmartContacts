// Applier — applies a Changeset atomically to the local DB in one transaction.
// RO-INVARIANT: INV-2 (changeset applied as a single atomic transaction), INV-6 (only after dry-run + user confirm).
//
// Changeset is imported from differ.ts (single source of truth). The Applier owns the
// SQL-column mapping (fieldPath → columnName) and snapshot hydration internally.
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
import type { NormalizedContact } from './types'
import type { Changeset, FieldUpdate } from './differ'

// ---------------------------------------------------------------------------
// Minimal contact interface required by Applier (avoids hard dependency on
// the concrete contactsRepo factory which bundles Lamport-clock logic).
// ---------------------------------------------------------------------------

export interface ContactsRepoLike {
  /** Lookup a contact by Google resource name; returns null if not found. */
  listByGoogleResourceName(resourceName: string): Promise<{ id: string } | null>
}

// ---------------------------------------------------------------------------
// Changeset is imported from differ.ts — single source of truth.
// Re-exported here so existing callers can still import from './applier'.
// ---------------------------------------------------------------------------
export type { Changeset, FieldUpdate }

// ---------------------------------------------------------------------------
// fieldPath → SQL column name mapping
// (differ uses camelCase field paths; contacts table uses snake_case columns)
// ---------------------------------------------------------------------------

const FIELD_PATH_TO_COLUMN: Readonly<Record<string, string>> = {
  displayName: 'display_name',
  givenName: 'given_name',
  familyName: 'family_name',
  middleName: 'middle_name',
  honorificPrefix: 'honorific_prefix',
  honorificSuffix: 'honorific_suffix',
  phoneticGiven: 'phonetic_given',
  phoneticFamily: 'phonetic_family',
  nickname: 'nickname',
  notesMd: 'notes_md',
  locale: 'locale',
  gender: 'gender',
  occupation: 'occupation',
  userDefined: 'user_defined',
  phones: 'phones',
  emails: 'emails',
  addresses: 'addresses',
  events: 'events',
  organizations: 'organizations',
  urls: 'urls',
  imClients: 'im_clients',
  'photos[0]': 'avatar_hash',
  photoUrl: 'avatar_hash',
  photoContentHash: 'avatar_hash',
}

/** Resolve fieldPath to SQL column name; returns null for unknown paths (they are skipped). */
function resolveColumn(fieldPath: string): string | null {
  const direct = FIELD_PATH_TO_COLUMN[fieldPath]
  if (direct !== undefined) return direct
  // Array sub-paths (e.g. 'phones[+1.23..]') → use the array column
  const arrayBase = fieldPath.split('[')[0]
  if (arrayBase !== undefined && FIELD_PATH_TO_COLUMN[arrayBase] !== undefined) {
    return FIELD_PATH_TO_COLUMN[arrayBase] ?? null
  }
  return null
}

/**
 * Encode a FieldUpdate newValue to a SQL-compatible value.
 * Arrays and objects are JSON-encoded; scalars are passed as-is.
 */
function encodeFieldValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * Group FieldUpdates for a single contact by unique column name.
 * Duplicates for same column are de-duplicated (last write wins).
 */
function groupUpdatesByColumn(
  updates: FieldUpdate[],
): Array<{ columnName: string; encodedValue: string | null }> {
  const seen = new Map<string, string | null>()
  for (const u of updates) {
    const col = resolveColumn(u.fieldPath)
    if (col !== null) {
      seen.set(col, encodeFieldValue(u.newValue))
    }
  }
  return Array.from(seen.entries()).map(([columnName, encodedValue]) => ({
    columnName,
    encodedValue,
  }))
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

        // -- Build googleResourceName → contacts.id (ULID) resolver --
        // The differ stage uses googleResourceName as a surrogate contactId in
        // FieldUpdate / ConflictRecord / labels.memberships. We resolve to the
        // real local ULID here, in-transaction, so all downstream writes target
        // the correct row.
        const idByResourceName = new Map<string, string>()
        {
          const rows = await tx.select<{ id: string; google_resource_name: string }>(
            'SELECT id, google_resource_name FROM contacts WHERE google_resource_name IS NOT NULL',
          )
          for (const r of rows) idByResourceName.set(r.google_resource_name, r.id)
        }

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

          // Make newly-inserted contact's id available for downstream label
          // memberships that may reference its googleResourceName in the same run.
          idByResourceName.set(normalized.googleResourceName, id)

          appliedCount++
        }

        // -- (b) cleanUpdates: update contacts + snapshots --
        // Group FieldUpdates by googleResourceName (differ's surrogate), then
        // resolve each to a real contacts.id before writing.
        const updatesByResourceName = new Map<string, FieldUpdate[]>()
        for (const fu of changeset.cleanUpdates) {
          const existing = updatesByResourceName.get(fu.googleResourceName)
          if (existing !== undefined) {
            existing.push(fu)
          } else {
            updatesByResourceName.set(fu.googleResourceName, [fu])
          }
        }

        for (const [googleResourceName, updates] of updatesByResourceName) {
          const localId = idByResourceName.get(googleResourceName)
          if (localId === undefined) {
            // Differ produced an update for a contact we don't have locally.
            // Shouldn't happen for clean updates (ours must exist in oursMap for
            // mergeOne to fire), but be defensive.
            continue
          }

          // Resolve semantic fieldPaths → SQL columns
          const colUpdates = groupUpdatesByColumn(updates)

          if (colUpdates.length > 0) {
            const setClauses = colUpdates.map((cu) => `${cu.columnName} = ?`).join(', ')
            const params: unknown[] = colUpdates.map((cu) => cu.encodedValue)
            await tx.execute(
              `UPDATE contacts SET ${setClauses}, updated_at = ?, google_last_synced_at = ? WHERE id = ?`,
              [...params, now, now, localId],
            )
          } else {
            // No recognized column changes — still update timestamps
            await tx.execute(
              `UPDATE contacts SET google_last_synced_at = ?, updated_at = ? WHERE id = ?`,
              [now, now, localId],
            )
          }

          // Upsert snapshot with latest normalized data (from updatedNormalized map)
          const normalized = changeset.updatedNormalized.get(googleResourceName)
          if (normalized !== undefined) {
            const snapshotRepo = new SnapshotRepo(tx)
            await snapshotRepo.upsert({
              googleResourceName,
              etag: normalized.etag,
              updateTime: normalized.updateTime,
              payloadJson: JSON.stringify(normalized),
              lastSyncedAt: now,
            })
          }

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
        // Translate surrogate contactId (= googleResourceName) → real local ULID.
        // For conflicts on contacts that don't exist locally yet (e.g. deletion
        // conflict where local was already gone), skip — there's no FK to satisfy.
        const conflictRepo = new ConflictRepo(tx)
        const pendingRows: NewConflict[] = []
        for (const c of changeset.conflicts) {
          const localId = idByResourceName.get(c.googleResourceName)
          if (localId === undefined) continue
          pendingRows.push({
            contactId: localId,
            googleResourceName: c.googleResourceName,
            fieldPath: c.fieldPath,
            baseValueJson: c.baseValueJson,
            googleValueJson: c.googleValueJson,
            localValueJson: c.localValueJson,
            detectedAt: c.detectedAt,
          })
        }
        await conflictRepo.insertPending(pendingRows)
        conflictCount = pendingRows.length

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
        // Memberships map is keyed by googleResourceName from the differ;
        // translate to real local ULID before writing.
        for (const [gResourceName, labelResourceNames] of changeset.labels.memberships) {
          const localId = idByResourceName.get(gResourceName)
          if (localId === undefined) continue
          await tx.execute('DELETE FROM google_label_memberships WHERE contact_id = ?', [localId])
          for (const resourceName of labelResourceNames) {
            await tx.execute(
              `INSERT INTO google_label_memberships (contact_id, label_resource_name)
               VALUES (?, ?)`,
              [localId, resourceName],
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
