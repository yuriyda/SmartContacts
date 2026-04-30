# Smart Contacts — Plan P4: Device sync (Lamport state-based)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Port TaskOrchestrator's state-based sync engine adapted for `contacts` + `custom_field_defs` + (later) avatar bundles. Add `drive.appdata` transport behind a feature flag, plus a "Sync now" button in Settings that's disabled until Google OAuth is configured. OAuth itself (the GIS sign-in flow) is deferred to P5 — P4 plumbs everything else end-to-end.

**Architecture:** `shared/src/sync/sync.ts` is a near-1:1 port of `tauri-app/src/store/sync.ts` from TaskOrchestrator. `buildSyncRequest`, `computeSyncPackage`, `importSyncPackage` work over `contacts` + `customFieldDefs`. Vector clock and Lamport rules unchanged. Transport layer (`shared/src/google/driveAppdata.ts`) is wired to GIS access tokens but P4 adds an "OAuth not yet configured" guard so the engine can be unit-tested with two adapters in-process.

**Spec:** §4 (sync engine, identical to reference). §5/6 deferred to P5. Avatar transport stub: `SyncPackage.avatars` field accepted but always `undefined` until P5.

---

## Standing rules

1. Each task ends with `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.
2. Header on every TS module; English-only commits; no Claude attribution.
3. **No nested transactions** in the adapter; P4 sync code MUST flatten — `bumpLamportInTx` is the inline helper, never the public `bumpLamport` inside `db.transaction`.
4. Browser smoke required when UI changes.

---

## Task 1: Sync engine port

**Files:**
- Create: `shared/src/sync/sync.ts`, `shared/src/sync/sync.test.ts`
- Modify: `shared/src/index.ts`

Port `tauri-app/src/store/sync.ts` line by line, replacing:
- `tasks` → `contacts` (column list, ordering, INSERT_IGN constant, etc.)
- `notes` → drop (no notes-table-as-separate-entity in our schema; `notes_md` is a column on contacts, no extra sync logic)
- `flow_meta` → `custom_field_defs`
- Lookup tables (`lists`, `tags`, `flows`, `personas`) → `tags_index`, `groups_index` — derived per device, NOT in the package (matches reference convention).

Public API:

```ts
import type { Contact, CustomFieldDef, SyncPackage, SyncRequest, VectorClock } from '../types'
import type { DbAdapter } from '../db/adapter'

export async function buildSyncRequest(db: DbAdapter): Promise<SyncRequest>
export async function computeSyncPackage(db: DbAdapter, targetVC?: VectorClock): Promise<SyncPackage>
export async function importSyncPackage(
  db: DbAdapter, pkg: SyncPackage,
): Promise<{ stats: { applied: number; skipped: number; outdated: number }; response: SyncPackage }>
```

`shouldReplace(incomingLts, localLts, incomingDid, localDid)`: incoming wins iff `incomingLts > localLts`, OR `incomingLts == localLts && incomingDid > localDid`. Identical to reference.

Tests cover:
- Two-device convergence: deviceA inserts, deviceB pulls, both have same data.
- Lamport tie-break on conflicting edit.
- Tombstone propagation (soft-deleted contact appears as deleted on the other device).
- Custom-field-def updates.
- Lookup tables after import are GC'd.

## Task 2: Drive `appdata` transport (skeleton, no OAuth yet)

**Files:**
- Create: `shared/src/google/driveAppdata.ts`, `shared/src/google/driveAppdata.test.ts` (transport mocked)
- Create: `shared/src/google/oauth.ts` (GIS-based; for now exports a stub `requestAccessToken()` that throws `OAUTH_NOT_CONFIGURED`)
- Modify: `shared/src/index.ts`

Public API (drive):

```ts
export interface DriveAppdataClient {
  /** Look up our sync file's id. Returns null when no file exists yet. */
  findSyncFileId(accessToken: string): Promise<string | null>
  /** Upload a JSON bundle to the named file (creates if missing). */
  uploadBundle(accessToken: string, fileName: string, bundle: object): Promise<string /* fileId */>
  /** Download bundle JSON. */
  downloadBundle(accessToken: string, fileId: string): Promise<unknown>
}
export function makeDriveAppdataClient(fetchImpl?: typeof fetch): DriveAppdataClient
```

`fetchImpl` lets tests inject a mock `fetch` returning canned responses. Implementation uses `https://www.googleapis.com/drive/v3/files` endpoints with `Authorization: Bearer ${accessToken}` and `spaces=appDataFolder`.

OAuth (`oauth.ts`):

```ts
export class OAuthNotConfiguredError extends Error {
  constructor() { super('OAUTH_NOT_CONFIGURED') }
}
export interface OAuthConfig {
  clientId: string
  scopes: string[]
}
export interface AccessTokenSource {
  getAccessToken(): Promise<string>
}
/** Returns a no-op source that throws OAuthNotConfiguredError until P5 wires GIS. */
export function makeStubAccessTokenSource(): AccessTokenSource
```

Tests mock `fetch` and verify upload/download payload shape.

## Task 3: SyncEngine — high-level orchestrator

**Files:**
- Create: `shared/src/sync/syncEngine.ts`, `shared/src/sync/syncEngine.test.ts`

Combines local + transport:

```ts
export interface SyncEngineDeps {
  db: DbAdapter
  drive: DriveAppdataClient
  tokenSource: AccessTokenSource
}
export interface SyncResult {
  stats: { applied: number; skipped: number; outdated: number }
  uploadedBytes: number
  downloadedBytes: number
}
/**
 * Pull remote bundle (if any), import into local db, push local merged bundle back.
 * Throws OAuthNotConfiguredError until P5 wires sign-in.
 */
export async function syncOnce(deps: SyncEngineDeps): Promise<SyncResult>
```

Tests with two in-process databases simulate bundle file in memory; verify convergence after `syncOnce` from each side.

## Task 4: Settings — Google Sync tab (disabled state)

**Files:**
- Create: `web/src/ui/settings/GoogleSyncTab.tsx`
- Modify: `web/src/ui/SettingsDialog.tsx` (add the tab)
- Modify: `shared/src/i18n/{en,ru}.ts` (`settings.tabs.google_sync`, `sync.not_configured`, `sync.now`, `sync.last`)

The tab shows:
- Status: `OAuth not configured (P5 will add Sign in with Google)`.
- Disabled `Sync now` button.
- Disabled `Reset sync state` button.

When P5 lands, this tab will be replaced with sign-in flow + actual functionality.

## Task 5: BACKLOG entry — P5 work

Add to `BACKLOG.md` under "P5":
- Wire `gis-script` via `<script async defer src="https://accounts.google.com/gsi/client">` and replace `makeStubAccessTokenSource` with a real one.
- Update `GoogleSyncTab` to show sign-in / sign-out + last-sync-time + Sync now.
- Read user's OAuth client id from a config file or env: `import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID`. Document in `GOOGLE_SETUP.md`.
- Wire `Sync now` to call `syncEngine.syncOnce`.
- Connect `MergeConflictDialog` (P5) when a per-record etag mismatch is detected.

## Manual verification (P4)

- Unit tests cover convergence + transport mocking.
- Browser: Settings → Google Sync tab visible with disabled state; clicking buttons does nothing; UI is themed.
