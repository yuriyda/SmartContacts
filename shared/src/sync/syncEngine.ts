/**
 * syncEngine.ts — High-level sync orchestrator for Smart Contacts.
 *
 * Combines local sync semantics (sync.ts) with the Drive transport
 * (driveAppdata.ts) to produce a single `syncOnce` operation:
 *   1. Fetch the access token (propagates OAuthNotConfiguredError until P5).
 *   2. Download the remote bundle from Drive's appDataFolder (if present).
 *   3. Import the remote bundle into the local DB.
 *   4. Compute a full local snapshot and upload it back to Drive.
 *
 * Transport-only orchestration. Sync semantics live in sync.ts (no merging logic here).
 *
 * Editing rules:
 *  - Do NOT add retry / token-refresh logic. Token errors propagate to caller.
 *  - Do NOT touch pkg.avatars — avatar transport is P5 scope.
 *  - Do NOT import from web/ or pwa/ — this module is pure shared.
 *  - fileName defaults to 'smart-contacts-sync.json'.
 *  - Malformed remote bundles (missing type:'sync_package') are silently ignored.
 */

import type { DbAdapter } from '../db/adapter'
import type { DriveAppdataClient } from '../google/driveAppdata'
import type { AccessTokenSource } from '../google/oauth'
import type { SyncPackage } from '../types'
import { computeSyncPackage, importSyncPackage } from './sync'

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface SyncEngineDeps {
  db: DbAdapter
  drive: DriveAppdataClient
  tokenSource: AccessTokenSource
  /** File name on Drive's appDataFolder. Default: 'smart-contacts-sync.json'. */
  fileName?: string
}

export interface SyncResult {
  stats: { applied: number; skipped: number; outdated: number }
  uploadedBytes: number
  downloadedBytes: number
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Pull remote bundle (if any), import into local db, push local merged bundle back.
 * Throws OAuthNotConfiguredError until P5 wires sign-in.
 */
export async function syncOnce(deps: SyncEngineDeps): Promise<SyncResult> {
  const { db, drive, tokenSource } = deps
  const fileName = deps.fileName ?? 'smart-contacts-sync.json'

  // Step 1: get access token — propagates OAuthNotConfiguredError from stub
  const accessToken = await tokenSource.getAccessToken()

  // Step 2: locate remote file
  const fileId = await drive.findSyncFileId(accessToken, fileName)

  let importedStats: { applied: number; skipped: number; outdated: number } = {
    applied: 0,
    skipped: 0,
    outdated: 0,
  }
  let downloadedBytes = 0

  // Step 3: download and import remote bundle (if it exists)
  if (fileId !== null) {
    const remoteJson = await drive.downloadBundle(accessToken, fileId)

    // Validate it is a SyncPackage; silently skip malformed bundles
    if ((remoteJson as { type?: unknown }).type === 'sync_package') {
      const imported = await importSyncPackage(db, remoteJson as SyncPackage)
      importedStats = imported.stats
      downloadedBytes = JSON.stringify(remoteJson).length
    }
    // If not a valid sync_package, treat as no-remote (silent)
  }

  // Steps 4-6: compute full local snapshot and upload
  const outgoing = await computeSyncPackage(db, {})
  await drive.uploadBundle(accessToken, fileName, outgoing as unknown as object)
  const uploadedBytes = JSON.stringify(outgoing).length

  return {
    stats: importedStats,
    uploadedBytes,
    downloadedBytes,
  }
}
