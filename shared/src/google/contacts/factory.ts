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
//
// resolveConflict — orchestrates all side-effects for conflict resolution (spec §6.7).
//  - Runs ALL side-effects in a SINGLE db.transaction() for atomicity.
//  - ConflictRepo remains pure CRUD — mutations to contacts/snapshots happen here.
//  - Dispatches by fieldPath: scalar, photos[0], __deletion__, array sub-paths.

import { ulid } from '../../ulid'
import type { DbAdapter } from '../../db/adapter'
import { rowToContact } from '../../db/contactRow'

import {
  runTauriLoopbackOauthFlow,
  refreshAccessToken,
  InvalidGrantError,
} from './oauth/tauri-loopback'
import type { TokenStore } from './oauth/token-store-tauri'
import { makeClientIdStore, type ClientIdStore } from './oauth/client-id-store'
import { makeClientSecretStore, type ClientSecretStore } from './oauth/client-secret-store'
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
import { downloadPhoto, RateLimitedError } from './read/photo-fetch'

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
  /**
   * Resolve a conflict with real side-effects (spec §6.7).
   * Runs all DB mutations atomically in one transaction.
   * Replaces direct runtime.repos.conflict.resolve() calls from UI.
   */
  resolveConflict(
    id: number,
    resolution: 'local' | 'google' | 'custom',
    customValueJson?: string | null,
  ): Promise<void>
  /** Repos exposed for UI components that need direct access. */
  repos: {
    snapshot: SnapshotRepo
    conflict: ConflictRepo
    label: LabelRepo
    syncLog: SyncLogRepo
  }
  /** UI Setup section reads/writes client_id via this store (persisted in meta table). */
  clientIdStore: ClientIdStore
  /** UI Setup section reads/writes client_secret via this store (persisted in meta table). */
  clientSecretStore: ClientSecretStore
  /**
   * Lazy on-demand avatar fetch (spec follow-up: bulk photo phase is unworkable
   * for 1000+ contacts due to Google CDN per-IP rate limit on lh3-lh6).
   *
   * Semantics:
   *  - Already-downloaded → returns 'cached' without touching the network.
   *  - Snapshot has no photoUrl → 'no-url'.
   *  - HTTP 429 from CDN → opens a 60s global circuit breaker → 'rate-limited'.
   *  - Other download error → 'failed' (logged via syncLogRepo).
   *  - Success → INSERT into `avatars` and returns 'ok'.
   *
   * Concurrent calls for the same contactId share a single in-flight Promise,
   * so opening the same contact twice quickly does NOT spawn two fetches.
   */
  fetchAvatarOnDemand(
    contactId: string,
    googleResourceName: string,
  ): Promise<'ok' | 'cached' | 'rate-limited' | 'no-url' | 'failed'>
  /** Read stored avatar bytes for a contact; null if none. */
  getAvatarBlob(contactId: string): Promise<{ blob: Uint8Array; mime: string } | null>
  /**
   * Return contacts (by local id) for which Google’s snapshot declares a
   * non-null `photoUrl`. Independent of whether the photo bytes have been
   * fetched locally yet — the list-view “has photo” marker reflects what
   * Google has, not what we’ve cached.
   *
   * Cheap one-shot query against snapshots (1500 rows ≈ <5 ms via JSON1).
   */
  listGooglePhotoContactIds(): Promise<string[]>
  /**
   * Return every cached avatar (bytes + mime) keyed by `contactId`. Used by
   * the list view to render thumbnails for contacts whose photos have been
   * downloaded. Applies the same validity filters as `getAvatarBlob` so
   * legacy garbled rows are never surfaced.
   */
  listAvatarBlobs(): Promise<Array<{ contactId: string; blob: Uint8Array; mime: string }>>
  /**
   * One-shot cleanup for the duplicate fallout of a Disconnect-with-keep +
   * Reconnect + Sync sequence: `disconnect({deleteImported:false})` nulls
   * `google_resource_name` on every Google-imported contact, so the next
   * full sync inserts a fresh row per Google contact alongside the orphaned
   * original. This routine finds those orphans (NULL `google_resource_name`)
   * for which a Google-linked twin exists with the exact same display_name,
   * and deletes the orphan. Cascades drop interactions / tasks attached to
   * the deleted rows. Returns the number of orphans removed.
   */
  removeOrphanDuplicates(): Promise<number>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeGoogleSyncRuntime(opts: MakeGoogleSyncRuntimeOpts): GoogleSyncRuntime {
  const { db } = opts

  // --- Step 0: client_id and client_secret stores (persisted in meta table; read at OAuth-time, never cached) ---
  const clientIdStore = makeClientIdStore(db)
  const clientSecretStore = makeClientSecretStore(db)

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
    // Treat both null (never connected) and empty string (bug guard) as not connected.
    if (refreshToken === null || refreshToken === '') {
      throw new Error('NOT_CONNECTED')
    }

    const clientId = await clientIdStore.get()
    if (clientId === null) {
      throw new Error(
        'NO_CLIENT_ID: Set your Google OAuth Client ID in Settings → Google Contacts → Setup.',
      )
    }

    const clientSecret = await clientSecretStore.get()
    if (clientSecret === null || clientSecret === '') {
      throw new Error(
        'NO_CLIENT_SECRET: Set your Google OAuth Client Secret in Settings → Google Contacts → Setup.',
      )
    }

    let result: Awaited<ReturnType<typeof refreshAccessToken>>
    try {
      result = await refreshAccessToken({
        refreshToken,
        clientId,
        clientSecret,
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      })
    } catch (err) {
      if (err instanceof InvalidGrantError) {
        // Refresh token is no longer valid — clear stored credentials and log disconnect.
        await opts.tokenStore.clear()
        tokenCache.accessToken = null
        tokenCache.expiresAtMs = 0
        await syncLogRepo.append({
          runId: 'oauth-' + generateRunId(),
          event: 'oauth_disconnected',
          level: 'info',
          payload: { reason: 'invalid_grant' },
        })
      }
      throw err
    }

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
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
  })

  // --- Public methods ---

  async function connect(): Promise<void> {
    const clientId = await clientIdStore.get()
    if (clientId === null) {
      throw new Error(
        'NO_CLIENT_ID: Set your Google OAuth Client ID in Settings → Google Contacts → Setup.',
      )
    }
    const clientSecret = await clientSecretStore.get()
    if (clientSecret === null || clientSecret === '') {
      throw new Error(
        'NO_CLIENT_SECRET: Set your Google OAuth Client Secret in Settings → Google Contacts → Setup.',
      )
    }
    const result = await runTauriLoopbackOauthFlow({
      invoke: opts.oauthInvoke,
      openUrl: opts.oauthOpenUrl,
      clientId,
      clientSecret,
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    })
    // Defensive guard: runTauriLoopbackOauthFlow already throws on missing
    // refresh_token, but be safe — never write an empty string to the store.
    if (!result.refreshToken) {
      throw new Error('OAUTH_NO_REFRESH_TOKEN: OAuth flow completed but returned no refresh token.')
    }
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
    const t = await opts.tokenStore.read()
    return t !== null && t.length > 0
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

  // ---------------------------------------------------------------------------
  // fieldPath → SQL column map (mirrors applier.ts FIELD_PATH_TO_COLUMN)
  // ---------------------------------------------------------------------------

  const FIELD_TO_COLUMN: Readonly<Record<string, string>> = {
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
  }

  // Array column names used for array sub-path handling.
  const ARRAY_FIELD_NAMES = new Set([
    'phones',
    'emails',
    'addresses',
    'events',
    'organizations',
    'urls',
    'imClients',
  ])

  // ---------------------------------------------------------------------------
  // Key extraction functions — mirrors differ.ts logic exactly.
  // ---------------------------------------------------------------------------

  function phoneKey(p: { value: string }): string {
    return p.value.replace(/[^\d+]/g, '')
  }

  function emailKey(e: { value: string }): string {
    return e.value.toLowerCase().trim()
  }

  function addressKey(a: {
    street?: string | undefined
    postal?: string | undefined
    city?: string | undefined
    country?: string | undefined
  }): string {
    return JSON.stringify([
      (a.street ?? '').trim(),
      (a.postal ?? '').trim(),
      (a.city ?? '').trim(),
      (a.country ?? '').trim(),
    ])
  }

  function eventKey(e: { type: string; date: string }): string {
    return `${e.type}|${e.date}`
  }

  function orgKey(o: { name?: string | undefined; title?: string | undefined }): string {
    return `${o.name ?? ''}|${o.title ?? ''}`
  }

  function urlKey(u: { value: string }): string {
    return u.value.toLowerCase().trim()
  }

  function imKey(im: { protocol: string; handle: string }): string {
    return `${im.protocol}|${im.handle}`
  }

  type ArrayItem = Record<string, unknown>

  function getArrayKeyFn(fieldName: string): ((item: ArrayItem) => string) | null {
    switch (fieldName) {
      case 'phones':
        return (item) => phoneKey(item as { value: string })
      case 'emails':
        return (item) => emailKey(item as { value: string })
      case 'addresses':
        return (item) =>
          addressKey(
            item as {
              street?: string | undefined
              postal?: string | undefined
              city?: string | undefined
              country?: string | undefined
            },
          )
      case 'events':
        return (item) => eventKey(item as { type: string; date: string })
      case 'organizations':
        return (item) => orgKey(item as { name?: string | undefined; title?: string | undefined })
      case 'urls':
        return (item) => urlKey(item as { value: string })
      case 'imClients':
        return (item) => imKey(item as { protocol: string; handle: string })
      default:
        return null
    }
  }

  // ---------------------------------------------------------------------------
  // resolveConflict — orchestrates spec §6.7 side-effects
  // ---------------------------------------------------------------------------

  async function resolveConflict(
    id: number,
    resolution: 'local' | 'google' | 'custom',
    customValueJson?: string | null,
  ): Promise<void> {
    const now = (opts.now ?? (() => new Date()))().toISOString()
    const runId = 'resolve-' + (opts.generateRunId ?? (() => ulid()))()

    // Load the conflict row first (outside transaction — read-only).
    const conflictRows = await db.select<{
      id: number
      contact_id: string
      google_resource_name: string
      field_path: string
      base_value_json: string | null
      google_value_json: string | null
      local_value_json: string
      status: string
    }>('SELECT * FROM sync_conflicts WHERE id = ?', [id])

    if (conflictRows.length === 0) {
      throw new Error(`resolveConflict: conflict id=${id} not found`)
    }
    const conflict = conflictRows[0]!
    const contactId = conflict.contact_id
    const fieldPath = conflict.field_path

    await db.transaction(async (tx: import('../../db/adapter').DbAdapter) => {
      // ---- Dispatch by fieldPath ----

      if (fieldPath === '__deletion__') {
        // spec §6.7 deletion handling
        if (resolution === 'google') {
          // Apply the remote deletion: delete contact row (CASCADE handles the rest).
          await tx.execute('DELETE FROM contacts WHERE id = ?', [contactId])
          // No further snapshot or conflict update needed — CASCADE removes them.
          // Append log and return early (no conflict row to update after DELETE CASCADE).
          await tx.execute(
            `INSERT INTO google_contacts_sync_log (run_id, ts, event, level, payload_json)
             VALUES (?, ?, 'conflict_resolved', 'info', ?)`,
            [
              runId,
              now,
              JSON.stringify({
                conflict_id: id,
                resolution,
                contact_id: contactId,
                field_path: fieldPath,
              }),
            ],
          )
          return
        } else {
          // 'local': keep contact, detach from Google.
          await tx.execute(
            `UPDATE contacts
             SET google_resource_name = NULL,
                 google_etag = NULL,
                 google_last_synced_at = NULL,
                 updated_at = ?,
                 lamport_ts = lamport_ts + 1
             WHERE id = ?`,
            [now, contactId],
          )
          // Delete the snapshot row.
          await tx.execute('DELETE FROM google_contact_snapshots WHERE google_resource_name = ?', [
            conflict.google_resource_name,
          ])
          // Delete label memberships for this contact.
          await tx.execute('DELETE FROM google_label_memberships WHERE contact_id = ?', [contactId])
        }
      } else if (fieldPath === 'photos[0]') {
        // spec §6.7 photo handling
        if (resolution === 'google') {
          // Consume pending_google_avatars → write to avatars → update contacts.avatar_hash.
          const pendingRows = await tx.select<{
            contact_id: string
            mime: string
            blob: Uint8Array
            hash: string
          }>('SELECT * FROM pending_google_avatars WHERE contact_id = ?', [contactId])

          if (pendingRows.length > 0) {
            const pending = pendingRows[0]!
            // UPSERT into avatars table.
            await tx.execute(
              `INSERT INTO avatars (contact_id, blob, mime, source_url, fetched_at, hash)
               VALUES (?, ?, ?, NULL, ?, ?)
               ON CONFLICT(contact_id) DO UPDATE
               SET blob = excluded.blob,
                   mime = excluded.mime,
                   source_url = NULL,
                   fetched_at = excluded.fetched_at,
                   hash = excluded.hash`,
              [contactId, pending.blob, pending.mime, now, pending.hash],
            )
            // Update contacts.avatar_hash.
            await tx.execute(`UPDATE contacts SET avatar_hash = ?, updated_at = ? WHERE id = ?`, [
              pending.hash,
              now,
              contactId,
            ])
            // Delete the pending row.
            await tx.execute('DELETE FROM pending_google_avatars WHERE contact_id = ?', [contactId])
            // Update snapshot payload photoContentHash to Google hash.
            await _updateSnapshotPhotoHash(tx, conflict.google_resource_name, pending.hash, now)
          }
        } else {
          // 'local': discard the pending avatar, keep local avatars unchanged.
          await tx.execute('DELETE FROM pending_google_avatars WHERE contact_id = ?', [contactId])
          // Advance snapshot photo hash to local value (so future pulls don't re-conflict).
          const localHash =
            conflict.local_value_json !== 'null'
              ? (JSON.parse(conflict.local_value_json) as string | null)
              : null
          await _updateSnapshotPhotoHash(tx, conflict.google_resource_name, localHash, now)
        }
      } else if (_isArraySubPath(fieldPath)) {
        // Array sub-path conflict: phones[<key>]:suffix style.
        await _resolveArraySubPath(
          tx,
          contactId,
          conflict.google_resource_name,
          fieldPath,
          resolution,
          customValueJson ?? null,
          now,
        )
      } else {
        // Scalar field.
        const col = FIELD_TO_COLUMN[fieldPath]
        if (col === undefined) {
          throw new Error(`resolveConflict: unknown fieldPath "${fieldPath}"`)
        }

        // Determine the winning value.
        let winnerJson: string | null
        if (resolution === 'local') {
          winnerJson = conflict.local_value_json
        } else if (resolution === 'google') {
          winnerJson = conflict.google_value_json
        } else {
          // custom
          winnerJson = customValueJson ?? null
        }

        const winnerValue = winnerJson !== null ? (JSON.parse(winnerJson) as unknown) : null

        if (resolution === 'google' || resolution === 'custom') {
          // Write winner to contacts column.
          const encodedValue =
            winnerValue === null
              ? null
              : typeof winnerValue === 'string'
                ? winnerValue
                : JSON.stringify(winnerValue)
          await tx.execute(
            `UPDATE contacts SET ${col} = ?, updated_at = ?, lamport_ts = lamport_ts + 1 WHERE id = ?`,
            [encodedValue, now, contactId],
          )
        }
        // 'local': contacts row unchanged; only snapshot base advances.

        // Advance snapshot base: set that field in payload_json to winner value.
        await _updateSnapshotField(tx, conflict.google_resource_name, fieldPath, winnerValue, now)
      }

      // Always: mark conflict resolved.
      await tx.execute(
        `UPDATE sync_conflicts
         SET status = 'resolved',
             resolution = ?,
             custom_value_json = ?,
             resolved_at = ?
         WHERE id = ?`,
        [resolution, customValueJson ?? null, now, id],
      )

      // Append audit log.
      await tx.execute(
        `INSERT INTO google_contacts_sync_log (run_id, ts, event, level, payload_json)
         VALUES (?, ?, 'conflict_resolved', 'info', ?)`,
        [
          runId,
          now,
          JSON.stringify({
            conflict_id: id,
            resolution,
            contact_id: contactId,
            field_path: fieldPath,
          }),
        ],
      )
    })
  }

  // ---------------------------------------------------------------------------
  // Snapshot helper: update a single scalar field in payload_json.
  // ---------------------------------------------------------------------------

  async function _updateSnapshotField(
    tx: import('../../db/adapter').DbAdapter,
    googleResourceName: string,
    fieldPath: string,
    value: unknown,
    now: string,
  ): Promise<void> {
    const rows = await tx.select<{ payload_json: string; etag: string; update_time: string }>(
      'SELECT payload_json, etag, update_time FROM google_contact_snapshots WHERE google_resource_name = ?',
      [googleResourceName],
    )
    if (rows.length === 0) return // No snapshot to advance — skip.
    const row = rows[0]!
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    payload[fieldPath] = value
    await tx.execute(
      `UPDATE google_contact_snapshots SET payload_json = ?, last_synced_at = ? WHERE google_resource_name = ?`,
      [JSON.stringify(payload), now, googleResourceName],
    )
  }

  // ---------------------------------------------------------------------------
  // Snapshot helper: update photoContentHash in payload_json.
  // ---------------------------------------------------------------------------

  async function _updateSnapshotPhotoHash(
    tx: import('../../db/adapter').DbAdapter,
    googleResourceName: string,
    hash: string | null,
    now: string,
  ): Promise<void> {
    const rows = await tx.select<{ payload_json: string }>(
      'SELECT payload_json FROM google_contact_snapshots WHERE google_resource_name = ?',
      [googleResourceName],
    )
    if (rows.length === 0) return
    const row = rows[0]!
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    payload['photoContentHash'] = hash
    await tx.execute(
      `UPDATE google_contact_snapshots SET payload_json = ?, last_synced_at = ? WHERE google_resource_name = ?`,
      [JSON.stringify(payload), now, googleResourceName],
    )
  }

  // ---------------------------------------------------------------------------
  // Detect if a fieldPath is an array sub-path (e.g. phones[<key>]:suffix).
  // ---------------------------------------------------------------------------

  function _isArraySubPath(fieldPath: string): boolean {
    const match = fieldPath.match(/^([a-zA-Z]+)\[(.+?)\]/)
    if (!match) return false
    return ARRAY_FIELD_NAMES.has(match[1] ?? '')
  }

  // ---------------------------------------------------------------------------
  // Resolve an array sub-path conflict.
  // Parses phones[<key>]:suffix, finds the element in contacts.{col}, splices it.
  // ---------------------------------------------------------------------------

  async function _resolveArraySubPath(
    tx: import('../../db/adapter').DbAdapter,
    contactId: string,
    googleResourceName: string,
    fieldPath: string,
    resolution: 'local' | 'google' | 'custom',
    customValueJson: string | null,
    now: string,
  ): Promise<void> {
    // Parse fieldPath: e.g. "phones[+1-555-000-0001]:deleted_remotely"
    const match = fieldPath.match(/^([a-zA-Z]+)\[(.+?)\](?::(.+))?$/)
    if (!match) throw new Error(`resolveConflict: cannot parse array fieldPath "${fieldPath}"`)
    const fieldName = match[1]!
    const elementKey = match[2]!
    const suffix = match[3] ?? ''

    const col = FIELD_TO_COLUMN[fieldName]
    if (col === undefined) throw new Error(`resolveConflict: unknown array field "${fieldName}"`)

    const keyFn = getArrayKeyFn(fieldName)
    if (keyFn === null) throw new Error(`resolveConflict: no keyFn for field "${fieldName}"`)

    // Read current contacts array column.
    const contactRows = await tx.select<Record<string, unknown>>(
      `SELECT ${col} FROM contacts WHERE id = ?`,
      [contactId],
    )
    const currentArr: ArrayItem[] =
      contactRows.length > 0 && contactRows[0]![col] !== null && contactRows[0]![col] !== undefined
        ? (JSON.parse(contactRows[0]![col] as string) as ArrayItem[])
        : []

    let newArr: ArrayItem[]

    if (resolution === 'local') {
      // contacts unchanged; snapshot array just needs the local value under that key.
      // For 'deleted_remotely': local has the element → snapshot should reflect that.
      // We don't touch contacts. Just advance snapshot.
      newArr = currentArr
    } else {
      // 'google' or 'custom': rewrite the contacts array.
      if (suffix === 'deleted_remotely') {
        // Google deleted it; resolution='google' → remove from contacts.
        // resolution='custom' → replace with custom value.
        if (resolution === 'google') {
          newArr = currentArr.filter((item) => keyFn(item) !== elementKey)
        } else {
          const customEl =
            customValueJson !== null ? (JSON.parse(customValueJson) as ArrayItem) : null
          if (customEl !== null) {
            newArr = currentArr.map((item) => (keyFn(item) === elementKey ? customEl : item))
          } else {
            newArr = currentArr.filter((item) => keyFn(item) !== elementKey)
          }
        }
      } else if (suffix === 'added_diverged') {
        // Both added different versions. 'google': replace local version with Google's.
        const googleEl =
          contactRows.length > 0
            ? null // we'll fetch from conflict row below
            : null
        // We need the google value — it's stored in the conflict row, but we don't have it here.
        // Caller already resolved via conflict row. Re-query conflict for googleValueJson.
        const conflictData = await tx.select<{
          google_value_json: string | null
          local_value_json: string
        }>(
          'SELECT google_value_json, local_value_json FROM sync_conflicts WHERE contact_id = ? AND field_path = ?',
          [contactId, fieldPath],
        )
        const googleValueJson = conflictData[0]?.google_value_json ?? null
        if (resolution === 'google') {
          const googleEl2 =
            googleValueJson !== null ? (JSON.parse(googleValueJson) as ArrayItem) : null
          if (googleEl2 !== null) {
            newArr = currentArr.map((item) => (keyFn(item) === elementKey ? googleEl2 : item))
          } else {
            newArr = currentArr.filter((item) => keyFn(item) !== elementKey)
          }
        } else {
          // custom
          const customEl =
            customValueJson !== null ? (JSON.parse(customValueJson) as ArrayItem) : null
          if (customEl !== null) {
            newArr = currentArr.map((item) => (keyFn(item) === elementKey ? customEl : item))
          } else {
            newArr = currentArr
          }
        }
        void googleEl // suppress unused variable warning
      } else if (suffix === 'deleted_locally_but_remote_changed') {
        // Local deleted it, remote changed it. 'google': re-add Google version.
        const conflictData = await tx.select<{ google_value_json: string | null }>(
          'SELECT google_value_json FROM sync_conflicts WHERE contact_id = ? AND field_path = ?',
          [contactId, fieldPath],
        )
        const googleValueJson = conflictData[0]?.google_value_json ?? null
        if (resolution === 'google') {
          const googleEl =
            googleValueJson !== null ? (JSON.parse(googleValueJson) as ArrayItem) : null
          if (googleEl !== null) {
            newArr = [...currentArr, googleEl]
          } else {
            newArr = currentArr
          }
        } else {
          // custom
          const customEl =
            customValueJson !== null ? (JSON.parse(customValueJson) as ArrayItem) : null
          if (customEl !== null) {
            newArr = [...currentArr, customEl]
          } else {
            newArr = currentArr
          }
        }
      } else {
        // Generic diverged: same as added_diverged handling.
        const conflictData = await tx.select<{ google_value_json: string | null }>(
          'SELECT google_value_json FROM sync_conflicts WHERE contact_id = ? AND field_path = ?',
          [contactId, fieldPath],
        )
        const googleValueJson = conflictData[0]?.google_value_json ?? null
        if (resolution === 'google') {
          const googleEl =
            googleValueJson !== null ? (JSON.parse(googleValueJson) as ArrayItem) : null
          if (googleEl !== null) {
            newArr = currentArr.map((item) => (keyFn(item) === elementKey ? googleEl : item))
          } else {
            newArr = currentArr
          }
        } else {
          const customEl =
            customValueJson !== null ? (JSON.parse(customValueJson) as ArrayItem) : null
          if (customEl !== null) {
            newArr = currentArr.map((item) => (keyFn(item) === elementKey ? customEl : item))
          } else {
            newArr = currentArr
          }
        }
      }

      // Write updated array back to contacts.
      await tx.execute(
        `UPDATE contacts SET ${col} = ?, updated_at = ?, lamport_ts = lamport_ts + 1 WHERE id = ?`,
        [JSON.stringify(newArr), now, contactId],
      )
    }

    // Advance snapshot array to match the winner's view.
    await _updateSnapshotArrayField(
      tx,
      googleResourceName,
      fieldName,
      newArr,
      elementKey,
      keyFn,
      fieldPath,
      resolution,
      customValueJson,
      now,
    )
  }

  // ---------------------------------------------------------------------------
  // Snapshot helper: update an array field in payload_json.
  // For 'local' on deleted_remotely — snapshot should reflect the local element.
  // ---------------------------------------------------------------------------

  async function _updateSnapshotArrayField(
    tx: import('../../db/adapter').DbAdapter,
    googleResourceName: string,
    fieldName: string,
    localArr: ArrayItem[],
    elementKey: string,
    keyFn: (item: ArrayItem) => string,
    fieldPath: string,
    resolution: 'local' | 'google' | 'custom',
    customValueJson: string | null,
    now: string,
  ): Promise<void> {
    const rows = await tx.select<{ payload_json: string }>(
      'SELECT payload_json FROM google_contact_snapshots WHERE google_resource_name = ?',
      [googleResourceName],
    )
    if (rows.length === 0) return
    const row = rows[0]!
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    const snapshotArr = Array.isArray(payload[fieldName]) ? (payload[fieldName] as ArrayItem[]) : []
    const suffix = fieldPath.match(/\]:(.+)$/)?.[1] ?? ''

    let newSnapshotArr: ArrayItem[]

    if (resolution === 'local') {
      // Snapshot should reflect local value for this element (so future pull sees no diff).
      const localEl = localArr.find((item) => keyFn(item) === elementKey)
      if (localEl !== undefined) {
        // Element exists locally: ensure snapshot has it.
        const existsInSnapshot = snapshotArr.some((item) => keyFn(item) === elementKey)
        if (existsInSnapshot) {
          newSnapshotArr = snapshotArr.map((item) => (keyFn(item) === elementKey ? localEl : item))
        } else {
          newSnapshotArr = [...snapshotArr, localEl]
        }
      } else {
        // Element not in local (deleted locally): remove from snapshot too.
        newSnapshotArr = snapshotArr.filter((item) => keyFn(item) !== elementKey)
      }
    } else if (resolution === 'google') {
      // Snapshot should match Google version (localArr was already set to Google version if suffix !== deleted_locally...).
      if (suffix === 'deleted_remotely') {
        // Google deleted: remove from snapshot.
        newSnapshotArr = snapshotArr.filter((item) => keyFn(item) !== elementKey)
      } else if (suffix === 'deleted_locally_but_remote_changed') {
        // Google version was re-added to localArr — sync snapshot with it.
        const googleEl = localArr[localArr.length - 1] // just appended
        newSnapshotArr = [...snapshotArr.filter((i) => keyFn(i) !== elementKey)]
        if (googleEl !== undefined) newSnapshotArr.push(googleEl)
      } else {
        // Updated in localArr: mirror it in snapshot.
        newSnapshotArr = snapshotArr.map((item) => {
          const match = localArr.find((li) => keyFn(li) === keyFn(item))
          return match !== undefined ? match : item
        })
      }
    } else {
      // custom: same as google but with custom value.
      const customEl = customValueJson !== null ? (JSON.parse(customValueJson) as ArrayItem) : null
      if (customEl !== null) {
        const existsInSnapshot = snapshotArr.some((item) => keyFn(item) === elementKey)
        if (existsInSnapshot) {
          newSnapshotArr = snapshotArr.map((item) => (keyFn(item) === elementKey ? customEl : item))
        } else {
          newSnapshotArr = [...snapshotArr, customEl]
        }
      } else {
        newSnapshotArr = snapshotArr.filter((item) => keyFn(item) !== elementKey)
      }
    }

    payload[fieldName] = newSnapshotArr
    await tx.execute(
      `UPDATE google_contact_snapshots SET payload_json = ?, last_synced_at = ? WHERE google_resource_name = ?`,
      [JSON.stringify(payload), now, googleResourceName],
    )
  }

  // ---------------------------------------------------------------------
  // Lazy on-demand avatar fetch
  //
  // Bulk photo download during sync is unworkable for 1000+ contacts —
  // Google CDN (lh3-lh6.googleusercontent.com) per-IP tarpits faster than
  // any retry backoff can resolve. Instead, photos are fetched lazily when
  // a contact is opened in the UI, with three layers of safety:
  //   1. In-flight dedup per contactId — repeated opens never spawn parallel.
  //   2. Global 60s circuit breaker after any 429 — protects the IP from
  //      cascading rate-limit on user click-storms.
  //   3. maxRetries=0 in downloadPhoto — one shot, no backoff spam.
  // ---------------------------------------------------------------------

  const CIRCUIT_BREAKER_MS = 60_000
  const inFlightAvatarFetches = new Map<
    string,
    Promise<'ok' | 'cached' | 'rate-limited' | 'no-url' | 'failed'>
  >()
  let avatarRateLimitedUntilMs = 0

  async function fetchAvatarOnDemand(
    contactId: string,
    googleResourceName: string,
  ): Promise<'ok' | 'cached' | 'rate-limited' | 'no-url' | 'failed'> {
    const existing = inFlightAvatarFetches.get(contactId)
    if (existing !== undefined) return existing

    const promise: Promise<'ok' | 'cached' | 'rate-limited' | 'no-url' | 'failed'> = (async () => {
      // Already cached locally?
      const existingRows = await db.select<{ one: number }>(
        'SELECT 1 AS one FROM avatars WHERE contact_id = ?',
        [contactId],
      )
      if (existingRows.length > 0) return 'cached'

      // Circuit breaker open?
      const nowDate = (opts.now ?? (() => new Date()))()
      const nowMs = nowDate.getTime()
      if (nowMs < avatarRateLimitedUntilMs) return 'rate-limited'

      // Resolve the photo URL from the most recent snapshot for this contact.
      const snapshot = await snapshotRepo.get(googleResourceName)
      if (snapshot === null) return 'no-url'

      let payload: { photoUrl?: unknown }
      try {
        payload = JSON.parse(snapshot.payloadJson) as { photoUrl?: unknown }
      } catch {
        return 'no-url'
      }
      const photoUrl = payload.photoUrl
      if (typeof photoUrl !== 'string' || photoUrl.length === 0) return 'no-url'

      // Skip Google's default-placeholder URL: older snapshots wrote it as
      // photoUrl when the contact had no real user photo. Downloading would
      // succeed but produce a gray silhouette instead of initials, which is
      // worse UX than just showing initials.
      if (photoUrl.includes('/a/default-user')) return 'no-url'

      // Google's People API hands out URLs with `=s100` (100px) by default,
      // which is fine for the 64px avatar circle but pixelates in the
      // fullscreen lightbox. Bump to 400px on lazy fetch — same one-shot
      // request, no extra round-trip, sharper full-size preview later.
      const upsizedUrl = photoUrl.replace(/=s\d+(?:-[^=]*)?$/, '=s400')
      const fetchUrl = upsizedUrl === photoUrl ? `${photoUrl}=s400` : upsizedUrl

      const effectiveFetch = opts.fetchImpl ?? globalThis.fetch
      try {
        const { bytes, mime, hash } = await downloadPhoto(
          fetchUrl,
          effectiveFetch,
          undefined,
          0, // maxRetries=0 — single attempt; no backoff spam on tarpit.
        )

        const fetchedAt = nowDate.toISOString()
        // Store the URL we actually fetched (the upsized one). getAvatarBlob
        // uses this to detect rows downloaded by older builds at the default
        // =s100 size and auto-refresh them on next open.
        await db.execute(
          `INSERT INTO avatars (contact_id, blob, mime, source_url, fetched_at, hash)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(contact_id) DO UPDATE
           SET blob = excluded.blob,
               mime = excluded.mime,
               source_url = excluded.source_url,
               fetched_at = excluded.fetched_at,
               hash = excluded.hash`,
          [contactId, bytes, mime, fetchUrl, fetchedAt, hash],
        )
        return 'ok'
      } catch (err) {
        if (err instanceof RateLimitedError) {
          avatarRateLimitedUntilMs = nowMs + CIRCUIT_BREAKER_MS
          await syncLogRepo.append({
            runId: 'avatar-on-demand',
            event: 'photo_download_failed',
            level: 'warn',
            payload: {
              contactId,
              googleResourceName,
              error: 'rate_limited',
              cooldownMs: CIRCUIT_BREAKER_MS,
            },
          })
          return 'rate-limited'
        }
        const message = err instanceof Error ? err.message : String(err)
        await syncLogRepo.append({
          runId: 'avatar-on-demand',
          event: 'photo_download_failed',
          level: 'warn',
          payload: { contactId, googleResourceName, error: message },
        })
        return 'failed'
      }
    })().finally(() => {
      inFlightAvatarFetches.delete(contactId)
    })

    inFlightAvatarFetches.set(contactId, promise)
    return promise
  }

  async function getAvatarBlob(
    contactId: string,
  ): Promise<{ blob: Uint8Array; mime: string } | null> {
    const rows = await db.select<{ blob: unknown; mime: string; source_url: string | null }>(
      'SELECT blob, mime, source_url FROM avatars WHERE contact_id = ?',
      [contactId],
    )
    const row = rows[0]
    if (row === undefined) return null

    // Self-heal #1 — older builds wrote Uint8Array via plugins-workspace#105's
    // broken BLOB path and stored a JSON-stringified object in TEXT. Detect
    // by string payload, drop, re-download cleanly via the inline-hex path.
    if (typeof row.blob === 'string') {
      await db.execute('DELETE FROM avatars WHERE contact_id = ?', [contactId])
      return null
    }

    // Self-heal #2 — earlier lazy-fetch builds (and bulk sync) wrote photos at
    // Google's default =s100 size, which pixelates in the lightbox. Drop any
    // row not yet upgraded to =s400 so the next open re-downloads sharper.
    // `source_url` is NULL for bulk-sync rows and contains '=s400' only for
    // lazy fetches issued by the current code path.
    if (row.source_url === null || !row.source_url.includes('=s400')) {
      await db.execute('DELETE FROM avatars WHERE contact_id = ?', [contactId])
      return null
    }

    let bytes: Uint8Array
    if (row.blob instanceof Uint8Array) {
      bytes = row.blob
    } else if (Array.isArray(row.blob)) {
      bytes = new Uint8Array(row.blob as number[])
    } else {
      // Unknown shape — treat as garbled and drop.
      await db.execute('DELETE FROM avatars WHERE contact_id = ?', [contactId])
      return null
    }
    return { blob: bytes, mime: row.mime }
  }

  async function removeOrphanDuplicates(): Promise<number> {
    // Pick orphans first so we can return an accurate count even if the
    // DELETE statement's rowsAffected isn't available through the adapter.
    const orphans = await db.select<{ id: string }>(
      `SELECT c1.id
       FROM contacts c1
       WHERE c1.google_resource_name IS NULL
         AND c1.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM contacts c2
           WHERE c2.google_resource_name IS NOT NULL
             AND c2.deleted_at IS NULL
             AND c2.display_name = c1.display_name
         )`,
    )
    if (orphans.length === 0) return 0
    // Chunked DELETE to keep the SQL string small for very large duplicate
    // sets (1500+). SQLite handles thousands of params fine, but staying
    // under 500 per batch keeps things predictable across adapters.
    const CHUNK = 500
    for (let i = 0; i < orphans.length; i += CHUNK) {
      const slice = orphans.slice(i, i + CHUNK)
      const placeholders = slice.map(() => '?').join(',')
      await db.execute(
        `DELETE FROM contacts WHERE id IN (${placeholders})`,
        slice.map((r) => r.id),
      )
    }
    await syncLogRepo.append({
      runId: 'orphan-cleanup',
      event: 'orphan_duplicates_removed',
      level: 'info',
      payload: { count: orphans.length },
    })
    return orphans.length
  }

  async function listAvatarBlobs(): Promise<
    Array<{ contactId: string; blob: Uint8Array; mime: string }>
  > {
    const rows = await db.select<{ contact_id: string; blob: unknown; mime: string }>(
      `SELECT contact_id, blob, mime FROM avatars
       WHERE typeof(blob) = 'blob'
         AND source_url IS NOT NULL
         AND source_url LIKE '%=s400%'`,
    )
    const out: Array<{ contactId: string; blob: Uint8Array; mime: string }> = []
    for (const r of rows) {
      // Tauri plugin-sql returns BLOB as number[] over JSON IPC; wa-sqlite
      // (browser tests) returns Uint8Array directly. Handle both.
      let bytes: Uint8Array
      if (r.blob instanceof Uint8Array) bytes = r.blob
      else if (Array.isArray(r.blob)) bytes = new Uint8Array(r.blob as number[])
      else continue
      out.push({ contactId: r.contact_id, blob: bytes, mime: r.mime })
    }
    return out
  }

  async function listGooglePhotoContactIds(): Promise<string[]> {
    // Snapshot's payload_json always carries the `photoUrl` key (the mapper
    // sets it to null when Google has no real user photo). JSON1's
    // json_extract is shipped with every modern SQLite (≥3.38), so it's
    // available in both wa-sqlite (browser tests) and Tauri's native sqlx.
    //
    // Heuristic against legacy snapshots: a real user photo has a unique URL
    // (contains a per-contact token), whereas Google's contact-metadata
    // placeholder URLs (`/cm/AGPWSu…` and `/a/default-user`) are reused across
    // many contacts at once. Diagnostic on a live 1500-contact DB showed
    // placeholders appearing 11-21 times each. Filtering by `COUNT(url) = 1`
    // separates real photos from placeholders without parsing People API
    // metadata that the old mapper has already thrown away.
    //
    // Once a full re-sync rewrites snapshots through the corrected mapper
    // (which writes null for placeholder photos in the first place), this
    // filter becomes redundant but harmless.
    const rows = await db.select<{ id: string }>(
      `WITH photo_counts AS (
         SELECT json_extract(payload_json, '$.photoUrl') AS url, COUNT(*) AS cnt
         FROM google_contact_snapshots
         WHERE json_extract(payload_json, '$.photoUrl') IS NOT NULL
         GROUP BY json_extract(payload_json, '$.photoUrl')
       )
       SELECT c.id
       FROM contacts c
       JOIN google_contact_snapshots s ON s.google_resource_name = c.google_resource_name
       JOIN photo_counts pc ON pc.url = json_extract(s.payload_json, '$.photoUrl')
       WHERE c.deleted_at IS NULL
         AND pc.cnt = 1
         AND pc.url NOT LIKE '%/a/default-user%'`,
    )
    return rows.map((r) => r.id)
  }

  return {
    pullEngine,
    isConnected,
    connect,
    disconnect,
    getPendingConflictCount,
    getLastSyncInfo,
    resolveConflict,
    fetchAvatarOnDemand,
    getAvatarBlob,
    listGooglePhotoContactIds,
    listAvatarBlobs,
    removeOrphanDuplicates,
    repos: {
      snapshot: snapshotRepo,
      conflict: conflictRepo,
      label: labelRepo,
      syncLog: syncLogRepo,
    },
    clientIdStore,
    clientSecretStore,
  }
}
