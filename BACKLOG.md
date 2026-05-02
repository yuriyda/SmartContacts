# Smart Contacts — Backlog

Items recorded during plan reviews that do not block the current plan but must
be addressed in a specific future plan or task. Each entry must name the owning
task; without an owner, an item does not belong here.

## P5 (Google Contacts integration)

- **`CalendarEvent.type` collapses Google free-text labels to `'custom'`.**
  Source: P1.T5 code review (M-3). Google People API allows arbitrary event labels
  (e.g. "Anniversary of meeting"). Our `CalendarEvent` enum maps them all to
  `'custom'` with no `label` field, silently losing the label string.
  P5 implementation must either: (a) extend `CalendarEvent` with `label?: string`
  and persist Google's label, or (b) explicitly document the data loss in the
  Google sync section.

- **Wire Google Identity Services (GIS) for real access tokens.**
  Source: P4.T2 (`shared/src/google/oauth.ts`). Today `makeStubAccessTokenSource()`
  throws `OAuthNotConfiguredError`. P5 must: (a) inject the GIS script via
  `<script async defer src="https://accounts.google.com/gsi/client">` in
  `web/index.html` and `pwa/index.html`; (b) read the OAuth client ID from
  `import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID`; (c) implement an
  `AccessTokenSource` backed by `google.accounts.oauth2.initTokenClient` with
  scope set including `drive.appdata`, `contacts`, `openid email profile`;
  (d) document the Google Cloud Console setup in a new `GOOGLE_SETUP.md`.

- **Replace `GoogleSyncTab` disabled state with real sign-in flow.**
  Source: P4.T4 (`web/src/ui/settings/GoogleSyncTab.tsx`). Tab is currently
  presentational with disabled buttons. P5 must replace it end-to-end with:
  signed-out CTA → `Sign in with Google` button; signed-in state showing email
  + last-sync timestamp (`meta.last_sync_at`) + working `Sync now` button + a
  working `Reset sync state` button (clears `vector_clock`, `meta.last_sync_at`,
  and remote `appDataFolder` file). On click of `Sync now`, call
  `syncEngine.syncOnce(deps)`.

- **Connect `MergeConflictDialog` for per-record conflicts.**
  Source: spec §5 + P4 plan task 5. When People API etag mismatch is detected
  during sync (Google copy diverged from our last-known etag), surface a
  conflict UI letting the user pick `local`, `remote`, or `merge field-by-field`.
  Component: `web/src/ui/MergeConflictDialog.tsx`. Wire from the Google
  Contacts adapter inside `syncEngine`.

- **People API field mapping module.**
  Source: spec §5. Create `shared/src/google/peopleMapping.ts` translating
  between our `Contact` type and Google People API JSON resources. All 15
  standard fields + extension fields where Google has equivalents
  (organizations, urls, addresses, events, im_clients, relations_external).
  Custom fields go to `userDefined`. Avatar URLs go through the P5 avatar
  pipeline (spec §6) — actual blobs not part of People API payloads.

## P4 (Sync engine)

- **`bumpLamport` is duplicated as private inline helper in repos.**
  Source: P2.T4 implementation. Public `bumpLamport(db)` wraps in `db.transaction`,
  which can't be called from inside an already-open tx (see nested-tx rule
  below). Repos inline a `bumpLamportInTx(tx)` helper that does the same
  SQL. Consolidate when the tx contract is revisited (e.g. SAVEPOINT support
  or splitting public/inner forms).

- **`searchByName` does Cyrillic case-folding in JS, not SQL.**
  Source: P2.T4 implementation. SQLite `lower()` / `COLLATE NOCASE` only handle
  ASCII; ICU extension is unavailable in wa-sqlite. The repo loads alive
  contacts and filters in JS. Acceptable for ≤ a few thousand contacts. If
  the dataset grows, consider an FTS5 virtual table or a derived
  `display_name_lower` column populated by a JS normalisation on write.

- **`DbAdapter.transaction` does not support nesting.**
  Source: P1.T8 code review (I-5). Adapter throws on a second `BEGIN` to
  prevent stuck connections. Sync engine work in P4 is "heavy transactional"
  per spec — verify all sync code paths are flat (no `transaction` inside
  `transaction`). If nesting is needed, extend the adapter with SAVEPOINT
  support before P4 ships.

## P6 (PWA — service worker dev activation)

- **`vite-plugin-pwa` dev SW does not always reach `active` state.**
  Source: P1 browser verification. With `devOptions.enabled: true`, the manifest
  link is injected and the SW is registered (`scope: /`), but `active`,
  `installing`, `waiting` were all false on a freshly-opened tab — the SW
  did not become controlling. Production build is fine (`dist/sw.js` +
  `dist/workbox-*.js` work). For real offline-first verification before P6
  ship, test against `vite preview` or a deployed build, not the dev server.

## P6 (PWA deployment / quota handling)

- **`close()`/`flushNow()` swallows IndexedDB errors silently.**
  Source: P1.T8 code review (I-4). Quota-exceeded or IDB-corrupt scenarios
  let `close()` resolve successfully without persisting the snapshot. PWA
  deployment must surface this failure to the user (toast or status-bar
  warning) and possibly retry. Consider adding a `forcePersist()` API or
  letting `close()` propagate the error.

## P4 / P5 / future Husky bumps

- **Husky-9 deprecated `pre-commit` body will fail under Husky v10.**
  Source: P1.T2 code review. Currently committed `.husky/pre-commit` uses the
  Husky-9-style scaffolding (`#!/usr/bin/env sh` + `_/husky.sh` source).
  Before any future bump of `husky` past `9.x`, rewrite the hook body to the
  single line `pnpm lint-staged`.

## Repo hygiene (P5 release prep or earlier)

- **Absolute `/workspace/` paths in `docs/superpowers/{specs,plans}/*.md`.**
  Source: P1.T1 code review. Container-local paths (e.g. `/workspace/TaskOrchestrator-main/`)
  do not resolve outside this dev environment. Normalize to repo-relative paths
  or descriptive prose before sharing the repo externally (cloning elsewhere,
  pushing to a remote).

## Dependency hygiene

- **Two moderate `pnpm audit` advisories on dev-only transitive deps.**
  Source: P1.T3 code review. Both target `vitest`'s transitive `vite` and
  `esbuild` (dev-server CORS, `.map` path traversal). Resolved by upgrading
  `vitest` to `^2.x`. Do as part of a dedicated dependency-update task or
  alongside any P-plan that already bumps tooling.

## P2 (CRUD)

- **`StatusBar` count refresh.** Source: P1.T12 review (M-1). Current
  `useEffect([db])` fires once at boot; after T12 the count is stale. P2 must
  add a write-side notification (event, query-key invalidation, or store
  subscription) so any insert/update/soft-delete refreshes the count.

- **Demo data generator (50 contacts × 2 locales).**
  Source: user request 2026-04-29 (parallel to TaskOrchestrator
  `tauri-app/src/core/demo.ts`). Spec frozen in
  `docs/superpowers/specs/2026-04-29-contacts-app-design.md` §9.1.
  Owner: P2. Module `shared/src/core/demo.ts` exporting
  `buildDemoContacts(locale): { contacts, groups, customFieldDefs }`,
  curated 50 entries each for `en` and `ru`, stable in-call ULIDs via
  `_idMap` so `relationsInternal` resolves, density distribution matches
  table in §9.1. Trigger: `Load demo data` button in Settings → General
  and in onboarding overlay, with confirm dialog and
  `meta.demo_seeded` idempotency guard.

## P12 (PWA mobile follow-ups)

- **PWA mobile sync stub — wire `runSync()` end-to-end.**
  Source: P11.T5 code review. `pwa/src/ui/mobile/screens/SettingsScreen.tsx:86–89`
  currently shows an inline message when "Sync now" is tapped — no actual sync.
  Plan §T5 called for `runSync(...)` invocation plus a "last sync timestamp"
  display. P12 must: (a) port Google OAuth wiring from `web/`, including the
  GIS `<script>` tag in `pwa/index.html` and `VITE_GOOGLE_OAUTH_CLIENT_ID`
  reading; (b) call `syncEngine.syncOnce(deps)` from the button handler;
  (c) read `meta.last_sync_at` and render it under the button as "Last sync:
  X minutes ago"; (d) add a "Reset sync state" button mirroring desktop. Must
  remain foreground-only per §22.6.

- **PWA mobile EditScreen — wire full field set.**
  Source: P11.T4 review (suggestion). EditScreen covers only givenName /
  familyName / displayName / primary phone / primary email / notesMd.
  Addresses, organizations, urls, im_clients, events, custom fields, tags,
  groups, priority are deferred. P12 must add a tabbed or segmented mobile
  form for these, ideally reusing pieces of `web/src/ui/ContactEditDialog`.

- **PWA mobile DetailScreen — responsive width override + custom fields.**
  Source: P11.T4 review (suggestion). `<ContactDetail>` defaults to 420px
  width, overflows on narrow phones (currently clipped by parent
  `overflow-y-auto`). Plus `defs={[]}` is passed, so custom fields don't
  render. P12 must: (a) add a `mobile` mode to `ContactDetail` that drops
  the fixed width and uses `min-w-0`/`w-full`; (b) pass real `defs` from
  `dbState.defsRepo` so custom fields render.

## Repo hygiene (P10 follow-up)

- **Physically move `wa-sqlite-backend.ts` and `snapshot-store.ts` into `web/`.**
  Source: P10.T1 audit. Plan §T1 called for a physical move; implementer chose
  a soft refactor (removed re-exports from `shared/src/index.ts`, kept files
  in place because 12+ shared/ test files import them via relative path).
  Boundary effect (no platform-specific code in shared's public API) is
  achieved. To strictly conform to plan §T1, do a follow-up that: (a) sets
  up vitest in `web/` (currently `pnpm test` in `web/` runs with
  `--passWithNoTests`); (b) moves the two source files + their .test.ts
  into `web/src/store/`; (c) rewrites all relative imports in shared/ tests
  to deep import from `@smart-contacts/web/store/wa-sqlite-backend`; (d)
  removes the deep-path imports in `web/src/store/useDb.ts`,
  `pwa/src/MobileApp.tsx`, and the tsconfig path mappings. Cosmetic only —
  current implementation is functionally correct.

## Coverage hygiene (P2 or earlier)

- **`shared/vitest.config.ts` coverage `exclude` list missing.**
  Source: P1.T3 code review. Currently `coverage.include: ['src/**']` instruments
  `index.ts` (re-export-only) and `test-setup.ts` (side-effect-only). Real
  coverage signal is diluted. Add when first non-trivial coverage gate is set.
