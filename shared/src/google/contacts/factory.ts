// RO-INVARIANT: factory wires Phase-1 modules. No write surface. No SDK.
//
// makeGoogleSyncRuntime — single entry point that assembles all Google Contacts
// read-only sync modules into a GoogleSyncRuntime consumed by the Tauri host.
//
// EDITING RULES:
//  - Do NOT import @tauri-apps/* directly — platform deps are injected via opts.
//  - Do NOT call Google write endpoints here or in any wired module.
//  - All comments must remain in English.
//  - No `any` types.

import { ulid } from '../../ulid'
import type { DbAdapter } from '../../db/adapter'
import { rowToContact } from '../../db/contactRow'

import { runTauriLoopbackOauthFlow, refreshAccessToken } from './oauth/tauri-loopback'
import type { TokenStore } from './oauth/token-store-tauri'
import { isConsentFresh } from './oauth/consent-policy'

import { GoogleContactsClient } from './read/client'
import { fetchAll } from './read/fetcher'
import { computeChangeset } from './read/differ'
import { Applier } from './read/applier'
import type { ContactsRepoLike } from './read/applier'
import { SnapshotRepo } from './read/snapshot-repo'
import { ConflictRepo } from './read/conflict-repo'
import { LabelRepo } from './read/label-repo'
import { SyncLogRepo } from './read/sync-log-repo'
import { PullEngine } from './read/pull-engine'
import { contactRowToNormalized } from './read/mapper'
import type { NormalizedContact } from './read/types'

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface MakeGoogleSyncRuntimeOpts {
  db: DbAdapter
  tokenStore: TokenStore
  /** Tauri invoke('cmd', args) wrapper passed in by host. */
  oauthInvoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>
  /** Tauri shell-open wrapper passed in by host. */
  oauthOpenUrl: (url: string) => Promise<void>
  /** Optional override for unit tests. */
  fetchImpl?: typeof fetch
  /** Optional override for unit tests. */
  now?: () => Date
  /** Optional override for unit tests. */
  generateRunId?: () => string
}

export interface GoogleSyncRuntime {
  /** The fully-wired pull engine. Call .run({confirmFn}) to sync. */
  pullEngine: PullEngine
  /** Direct access for tab UI: check current connection state. */
  isConnected(): Promise<boolean>
  /** Run the OAuth loopback flow + persist refresh token. Throws on cancel/error. */
  connect(): Promise<void>
  /** Clear local tokens + optionally remove Google-imported contacts. Does NOT call /revoke. */
  disconnect(opts: { deleteImported: boolean }): Promise<void>
  /** Pending conflict count (for badge). */
  getPendingConflictCount(): Promise<number>
  /** Most recent apply_complete event timestamp (for "Last sync" UI). null if never synced. */
  getLastSyncInfo(): Promise<{ ts: string; appliedCount: number } | null>
  /** Repos exposed for UI components that need direct access. */
  repos: {
    snapshot: SnapshotRepo
    conflict: ConflictRepo
    label: LabelRepo
    syncLog: SyncLogRepo
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeGoogleSyncRuntime(opts: MakeGoogleSyncRuntimeOpts): GoogleSyncRuntime {
  const { db } = opts

  // --- Step 1: Construct repos ---
  const snapshotRepo = new SnapshotRepo(db)
  const conflictRepo = new ConflictRepo(db)
  const labelRepo = new LabelRepo(db)
  const syncLogRepo = new SyncLogRepo(db)

  // --- Step 2: Construct Applier ---
  // contactsRepo for applier only needs listByGoogleResourceName.
  const applierContactsRepo: ContactsRepoLike = {
    async listByGoogleResourceName(resourceName: string): Promise<{ id: string } | null> {
      const rows = await db.select<{ id: string }>(
        'SELECT id FROM contacts WHERE google_resource_name = ? AND deleted_at IS NULL',
        [resourceName],
      )
      return rows[0] ?? null
    },
  }

  const applier = new Applier({
    db,
    snapshotRepo,
    conflictRepo,
    syncLogRepo,
    contactsRepo: applierContactsRepo,
  })

  // --- Step 3: Access-token cache ---
  interface TokenCache {
    accessToken: string | null
    expiresAtMs: number
  }
  const tokenCache: TokenCache = { accessToken: null, expiresAtMs: 0 }
  const TOKEN_MARGIN_MS = 60 * 1000

  async function getAccessToken(): Promise<string> {
    const now = (opts.now ?? (() => new Date()))()
    if (
      tokenCache.accessToken !== null &&
      now.getTime() < tokenCache.expiresAtMs - TOKEN_MARGIN_MS
    ) {
      return tokenCache.accessToken
    }

    const refreshToken = await opts.tokenStore.read()
    if (refreshToken === null) {
      throw new Error('NOT_CONNECTED')
    }

    const result = await refreshAccessToken({
      refreshToken,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    })
    tokenCache.accessToken = result.accessToken
    tokenCache.expiresAtMs = now.getTime() + result.expiresIn * 1000

    // If Google rotated the refresh token, persist the new one.
    if (result.refreshToken !== null) {
      await opts.tokenStore.write(result.refreshToken)
    }

    return result.accessToken
  }

  // --- Step 4: Construct GoogleContactsClient ---
  // runId is not available in the HttpAuditFn signature — log under a stable key.
  const HTTP_AUDIT_RUN_ID = 'http-audit'
  const client = new GoogleContactsClient({
    tokenSource: getAccessToken,
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    audit: async (entry) => {
      await syncLogRepo.append({
        runId: HTTP_AUDIT_RUN_ID,
        event: 'http_call',
        level: 'info',
        payload: {
          method: entry.method,
          url: entry.url,
          status: entry.status,
          durationMs: entry.durationMs,
        },
      })
    },
  })

  // --- Step 5: lastSyncTokenStore via meta table ---
  const SYNC_TOKEN_KEY = 'google_contacts.sync_token'
  const lastSyncTokenStore = {
    async read(): Promise<string | null> {
      const rows = await db.select<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [
        SYNC_TOKEN_KEY,
      ])
      if (rows.length === 0) return null
      try {
        return JSON.parse(rows[0]!.value) as string | null
      } catch {
        return null
      }
    },
    async write(token: string | null): Promise<void> {
      const serialized = JSON.stringify(token)
      await db.execute(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [SYNC_TOKEN_KEY, serialized],
      )
    },
  }

  // --- Step 6: consentPolicy ---
  const consentPolicy = { isConsentFresh }

  // --- Step 7: pull-engine contactsRepo (listGoogleContacts) ---
  const pullContactsRepo = {
    async listGoogleContacts(): Promise<NormalizedContact[]> {
      const rows = await db.select<Record<string, unknown>>(
        `SELECT * FROM contacts WHERE google_resource_name IS NOT NULL AND deleted_at IS NULL`,
      )
      return rows.map(rowToContact).map(contactRowToNormalized)
    },
  }

  // --- Step 8: Construct PullEngine ---
  const now = opts.now ?? (() => new Date())
  const generateRunId = opts.generateRunId ?? (() => ulid())

  const pullEngine = new PullEngine({
    client,
    fetcher: fetchAll,
    differ: computeChangeset,
    applier,
    snapshotRepo,
    contactsRepo: pullContactsRepo,
    labelRepo,
    syncLogRepo,
    consentPolicy,
    getAccessToken,
    lastSyncTokenStore,
    now,
    generateRunId,
  })

  // --- Public methods ---

  async function connect(): Promise<void> {
    const result = await runTauriLoopbackOauthFlow({
      invoke: opts.oauthInvoke,
      openUrl: opts.oauthOpenUrl,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    })
    await opts.tokenStore.write(result.refreshToken)
    await syncLogRepo.append({
      runId: 'oauth-' + generateRunId(),
      event: 'oauth_consent',
      level: 'info',
      payload: { grantedAt: result.grantedAt },
    })
  }

  async function disconnect(disconnectOpts: { deleteImported: boolean }): Promise<void> {
    if (disconnectOpts.deleteImported) {
      await db.execute(`DELETE FROM contacts WHERE google_resource_name IS NOT NULL`)
    } else {
      const now_ = (opts.now ?? (() => new Date()))().toISOString()
      await db.execute(
        `UPDATE contacts
         SET google_resource_name = NULL,
             google_etag = NULL,
             google_last_synced_at = NULL,
             updated_at = ?,
             lamport_ts = lamport_ts + 1
         WHERE google_resource_name IS NOT NULL`,
        [now_],
      )
    }

    // Always clear sync tables
    await db.execute(`DELETE FROM google_contact_snapshots`)
    await db.execute(`DELETE FROM sync_conflicts`)
    await db.execute(`DELETE FROM google_label_memberships`)
    await db.execute(`DELETE FROM google_labels`)
    await db.execute(`DELETE FROM pending_google_avatars`)

    await opts.tokenStore.clear()

    await syncLogRepo.append({
      runId: 'oauth-disconnect',
      event: 'oauth_disconnected',
      level: 'info',
      payload: { reason: 'user', deleteImported: disconnectOpts.deleteImported },
    })
  }

  async function isConnected(): Promise<boolean> {
    return (await opts.tokenStore.read()) !== null
  }

  async function getPendingConflictCount(): Promise<number> {
    return conflictRepo.count('pending')
  }

  async function getLastSyncInfo(): Promise<{ ts: string; appliedCount: number } | null> {
    const rows = await syncLogRepo.listLatest('apply_complete', 1)
    if (rows.length === 0) return null
    const row = rows[0]!
    try {
      const payload = JSON.parse(row.payloadJson ?? 'null') as {
        appliedCount?: number
        ts?: string
      } | null
      return {
        ts: row.ts,
        appliedCount: payload?.appliedCount ?? 0,
      }
    } catch {
      return { ts: row.ts, appliedCount: 0 }
    }
  }

  return {
    pullEngine,
    isConnected,
    connect,
    disconnect,
    getPendingConflictCount,
    getLastSyncInfo,
    repos: {
      snapshot: snapshotRepo,
      conflict: conflictRepo,
      label: labelRepo,
      syncLog: syncLogRepo,
    },
  }
}
