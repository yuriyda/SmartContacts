# Smart Contacts — Resume guide (post-compact 2026-04-30)

## State at compact

- Last commit: `e42cc88 feat(shared/sync): port state-based Lamport sync engine for contacts + customFieldDefs`
- Branch: `main`.
- All checks green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- 192 tests in `shared/`; web/pwa pass with no tests yet.
- Demo data load works end-to-end in browser (Chrome MCP verified during P2.T14).

## Done

- **P1** Foundation — monorepo, schema, wa-sqlite backend, themes, i18n, shells.
- **P2** CRUD + Desktop UI core — full TaskOrchestrator-styled three-pane UI;
  ContactDetail with sectioned read view; ContactEditDialog with multi-inputs
  + validation hints + mirror-rule on save; SettingsDialog with 5 tabs
  (General/CustomFields/Backup/About/Onboarding); demo data 50×2 locales;
  GuideOverlay onboarding; full hotkey layer; Toast undo on soft-delete.
- **P3** QuickEntry parser + UI in NavHeader; saved filter presets in `meta`;
  lookup GC for `tags_index` / `groups_index` after every contact write.
  T5 (Markdown live preview toggle) deferred.
- **P4.T1** Sync engine port (Lamport state-based, two-device convergence).

## Three critical bugs fixed during P2.T14 (don't reintroduce!)

1. **wa-sqlite single-shared-connection race**: concurrent React effects
   interleaved their `statements()` generators on the shared sqlite registry;
   `column(stmt)` threw "not a statement". Fix lives in
   `shared/src/db/wa-sqlite-backend.ts`: serialize `select`/`execute`/
   `transaction` through a single FIFO queue. Inner-of-tx calls bypass.
2. **Snapshot-flush debounce dropped writes**: 250ms timer reset every xSync;
   writes never reached IndexedDB if other writes followed within 250ms.
   Fix: explicit `await vfs.flushNow()` after every committed transaction
   AND after every outside-transaction execute().
3. **Multi-instance DB via duplicated `useDb()`**: GeneralTab, AboutTab,
   CustomFieldsTab each opened a SECOND wa-sqlite adapter. Demo writes
   landed in adapter B; parent's view read adapter A and saw zero. Fix:
   hoist `db / deviceId / contactsRepo / defsRepo` into AppContext
   singletons; children consume via `useApp()`. **Single `useDb()` only
   in `SmartContactsApp`**.

## Next steps (resume here)

### P4.T2 — driveAppdata + oauth stubs
- Create `shared/src/google/driveAppdata.ts`, `.test.ts`, `oauth.ts`.
- `OAuthNotConfiguredError`, `makeStubAccessTokenSource`.
- Mock `fetch` in tests, verify upload/download payload shapes.
- Re-export from `shared/src/index.ts`.

### P4.T3 — syncEngine
- Create `shared/src/sync/syncEngine.ts`, `.test.ts`.
- `syncOnce(deps)`: pull → import → push.
- Two in-process dbs sharing an in-memory bundle in tests.

### P4.T4 — Settings tab (disabled state)
- `web/src/ui/settings/GoogleSyncTab.tsx`.
- Add to SettingsDialog tab list. i18n keys: `settings.tabs.google_sync`,
  `sync.not_configured`, `sync.now`, `sync.last`.

### P4.T5 — BACKLOG entries for P5

### Pause for user (before P5)
P5 (Google Contacts API + avatars) requires a Google OAuth client ID:
- Type: Web application
- Authorised JavaScript origins: `http://localhost:5173`, `http://127.0.0.1:5173`
- Scopes: `https://www.googleapis.com/auth/drive.appdata`,
  `https://www.googleapis.com/auth/contacts`, `openid email profile`
- Place client ID in `web/.env.local` as `VITE_GOOGLE_OAUTH_CLIENT_ID=…`.

### P5 — Google Contacts integration
Plan from spec §5 (bidirectional sync, conflicts, etag) + §6 (avatar pipeline)
+ deferred `SyncPackage.avatars` handling. People API field mapping in
`shared/google/peopleMapping.ts`. MergeConflictDialog UI.

### P6 — PWA mobile parity
Port web/ UI patterns into `pwa/` shell (single-pane, bottom-nav,
swipe-actions). Real PWA icons.

## Standing rules

- Implementer subagents always `model: 'sonnet'`.
- No `Co-Authored-By: Claude` anywhere.
- English-only commits.
- Use `Edit` (not `Write`) for existing files.
- After every UI change: Chrome MCP smoke test (curl + build alone is
  insufficient — proven by P2.T14).
- All wa-sqlite tests need `// @vitest-environment node` +
  `import 'fake-indexeddb/auto'`.

## Quick start dev server (next session)

```
pnpm --filter @smart-contacts/web exec vite --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/`. Click ⚙ → Load demo data (English) → Confirm.

## Open issues parked in BACKLOG.md

- Husky 9 deprecated hook body (will fail under v10).
- StatusBar count refresh — wired via useContacts version counter; verify
  reactivity in any new view.
- Cyrillic case-folding is JS-side (acceptable up to a few thousand contacts).
- `bumpLamport` duplicated as `bumpLamportInTx` in repos.
- vite-plugin-pwa SW dev-mode activation flaky (production fine).
- Real PWA icons still 1×1 placeholders.
- 2 moderate `pnpm audit` advisories on dev-only transitive deps.
