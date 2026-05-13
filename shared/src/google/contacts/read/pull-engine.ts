// RO-INVARIANT: INV-2 (dry-run before apply), INV-6 (always confirm before apply).
// Orchestrator only — pure decisions delegated to differ; mutations to applier.
//
// PullEngine coordinates a single Google Contacts pull cycle:
//   1. Consent gate  →  2. Fetch  →  3. Diff  →  4. Confirm  →  5. Apply
//
// EDITING RULES:
//  - No write calls to people.googleapis.com; fetcher is read-only by contract.
//  - Do NOT add logic here that belongs in differ or applier.
//  - All error paths must log to syncLogRepo and return a typed PullResult.
//  - No `any` types.
//  - All comments must remain in English.

import type { GoogleContactsClient } from './client'
import type { fetchAll } from './fetcher'
import type { computeChangeset, Changeset } from './differ'
import type { Applier } from './applier'
import type { SnapshotRepo } from './snapshot-repo'
import type { SyncLogRepo } from './sync-log-repo'
import type { NormalizedContact } from './types'
import type { Person, ContactGroup } from './types'
import type { GoogleLabelRow } from './label-repo'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Called by UI layer to confirm or cancel before mutations are applied. */
export type ConfirmFn = (changeset: Changeset) => Promise<boolean>

export type PullResult =
  | { kind: 'applied'; appliedCount: number; conflictCount: number; runId: string }
  | { kind: 'cancelled'; runId: string }
  | { kind: 'up_to_date'; runId: string }
  | { kind: 'failed'; runId: string; error: Error }

/** Minimal interface for listing Google-imported contacts. */
export interface GoogleContactsReadRepo {
  /** Return all contacts that have a google_resource_name (Google-imported). */
  listGoogleContacts(): Promise<NormalizedContact[]>
}

export interface LabelRepo {
  listAll(): Promise<GoogleLabelRow[]>
}

export interface PullEngineDeps {
  client: GoogleContactsClient
  fetcher: typeof fetchAll
  differ: typeof computeChangeset
  applier: Applier
  snapshotRepo: SnapshotRepo
  contactsRepo: GoogleContactsReadRepo
  labelRepo: LabelRepo
  syncLogRepo: SyncLogRepo
  consentPolicy: {
    isConsentFresh(latestConsentTs: string | null, now: Date): boolean
  }
  getAccessToken: () => Promise<string>
  lastSyncTokenStore: {
    read(): Promise<string | null>
    write(token: string | null): Promise<void>
  }
  now: () => Date
  generateRunId: () => string
  /** Optional fetch override for photo download (passed through to fetcher). */
  fetchImpl?: typeof fetch
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Convert a ContactGroup to a GoogleLabelRow. */
function contactGroupToLabelRow(cg: ContactGroup, now: string): GoogleLabelRow {
  return {
    resourceName: cg.resourceName,
    name: cg.name,
    groupType: cg.groupType === 'USER_CONTACT_GROUP' ? 'user' : 'system',
    etag: cg.etag,
    lastSyncedAt: now,
  }
}

/**
 * Build a Map<googleResourceName, labelResourceNames[]> from persons'
 * memberships field (People API).
 */
function buildMembershipsFromPersons(persons: Person[]): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const person of persons) {
    const rn = person.resourceName
    if (rn === undefined) continue
    const labelNames: string[] = []
    for (const m of person.memberships ?? []) {
      const grn = m.contactGroupMembership?.contactGroupResourceName
      if (grn !== undefined) labelNames.push(grn)
    }
    if (labelNames.length > 0) result.set(rn, labelNames)
  }
  return result
}

// ---------------------------------------------------------------------------
// PullEngine
// ---------------------------------------------------------------------------

export class PullEngine {
  constructor(private deps: PullEngineDeps) {}

  async run({ confirmFn }: { confirmFn: ConfirmFn }): Promise<PullResult> {
    const runId = this.deps.generateRunId()

    try {
      // --- Step 1: Consent gate ---
      const consentTs = await this.deps.syncLogRepo.latestConsentTs()
      const now = this.deps.now()
      if (!this.deps.consentPolicy.isConsentFresh(consentTs, now)) {
        await this.deps.syncLogRepo.append({
          runId,
          event: 'error',
          level: 'error',
          payload: { message: 'CONSENT_EXPIRED' },
        })
        return { kind: 'failed', runId, error: new Error('CONSENT_EXPIRED') }
      }

      // --- Step 2: Pre-flight token check (also triggers token refresh if needed) ---
      // The accessToken is not used directly here — the client uses its own tokenSource.
      // This call ensures the token is valid before we start fetching.
      await this.deps.getAccessToken()

      // --- Step 3: Fetch from Google ---
      const syncToken = await this.deps.lastSyncTokenStore.read()
      const fetchResult = await this.deps.fetcher({
        client: this.deps.client,
        syncToken,
        runId,
        logger: this.deps.syncLogRepo,
        ...(this.deps.fetchImpl !== undefined ? { fetchImpl: this.deps.fetchImpl } : {}),
      })

      const nowIso = now.toISOString()

      // --- Step 4: Use pre-normalized persons from fetcher (includes photo bytes) ---
      // The fetcher runs personToNormalized + photo download in one pass.
      const theirs: NormalizedContact[] = fetchResult.normalizedPersons
      const deletedRemotely: string[] = fetchResult.deletedResourceNames

      // --- Step 5: Load ours + snapshots ---
      const ours = await this.deps.contactsRepo.listGoogleContacts()
      const allSnapshots = await this.deps.snapshotRepo.listAll()
      const snapshotMap = new Map<string, NormalizedContact>()
      for (const snap of allSnapshots) {
        try {
          const parsed = JSON.parse(snap.payloadJson) as NormalizedContact
          snapshotMap.set(snap.googleResourceName, parsed)
        } catch {
          // Malformed snapshot — skip; will be treated as no base
        }
      }

      // --- Step 6: Build label data ---
      const theirLabels: GoogleLabelRow[] = fetchResult.labels.map((cg) =>
        contactGroupToLabelRow(cg, nowIso),
      )
      const theirLabelMemberships = buildMembershipsFromPersons(fetchResult.persons)

      // --- Step 7: Compute changeset ---
      const changeset = this.deps.differ({
        runId,
        snapshots: snapshotMap,
        theirs,
        deletedRemotely,
        ours,
        theirLabels,
        theirLabelMemberships,
        now: nowIso,
      })

      // --- Step 8: Check if up-to-date ---
      const totalChanges =
        changeset.counts.inserts +
        changeset.counts.updates +
        changeset.counts.deletes +
        changeset.counts.conflicts

      if (totalChanges === 0) {
        await this.deps.syncLogRepo.append({
          runId,
          event: 'dry_run_computed',
          level: 'info',
          payload: { message: 'up_to_date', counts: changeset.counts },
        })
        return { kind: 'up_to_date', runId }
      }

      // --- Step 9: Log dry-run ---
      await this.deps.syncLogRepo.append({
        runId,
        event: 'dry_run_computed',
        level: 'info',
        payload: {
          counts: changeset.counts,
          inserts: changeset.cleanInserts.length,
          updates: changeset.cleanUpdates.length,
          deletes: changeset.cleanDeletes.length,
          conflicts: changeset.conflicts.length,
        },
      })

      // --- Step 10: Confirm ---
      const confirmed = await confirmFn(changeset)
      if (!confirmed) {
        await this.deps.syncLogRepo.append({
          runId,
          event: 'user_cancelled',
          level: 'info',
          payload: null,
        })
        return { kind: 'cancelled', runId }
      }

      await this.deps.syncLogRepo.append({
        runId,
        event: 'user_confirmed',
        level: 'info',
        payload: null,
      })

      // --- Step 11: Apply ---
      const applyResult = await this.deps.applier.apply(changeset)

      // --- Step 12: Persist sync token ---
      if (fetchResult.nextSyncToken !== null) {
        await this.deps.lastSyncTokenStore.write(fetchResult.nextSyncToken)
      }

      return {
        kind: 'applied',
        appliedCount: applyResult.appliedCount,
        conflictCount: applyResult.conflictCount,
        runId,
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await this.deps.syncLogRepo.append({
        runId,
        event: 'error',
        level: 'error',
        payload: { message: error.message, stack: error.stack },
      })
      return { kind: 'failed', runId, error }
    }
  }
}
