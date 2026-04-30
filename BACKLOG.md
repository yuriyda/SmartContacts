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

## P4 (Sync engine)

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

## Coverage hygiene (P2 or earlier)

- **`shared/vitest.config.ts` coverage `exclude` list missing.**
  Source: P1.T3 code review. Currently `coverage.include: ['src/**']` instruments
  `index.ts` (re-export-only) and `test-setup.ts` (side-effect-only). Real
  coverage signal is diluted. Add when first non-trivial coverage gate is set.
