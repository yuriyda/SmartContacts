# Smart Contacts

Decentralized, offline-first contact manager. Three distribution targets share `shared/` core logic and `web/`'s React UI:

- **`web/`** — debug-only browser SPA (Vite dev server). Used by the Claude Code agent for verification.
- **`tauri/`** — desktop release (Win / macOS / Linux) via Tauri 2 with native SQLite.
- **`pwa/`** — mobile release (Android first) via Capacitor 6 with native SQLite.

Spec: `docs/superpowers/specs/2026-04-29-contacts-app-design.md`. Distribution targets — §22.

## Workspace layout

```
shared/   pure logic, types, repos, sync engine, i18n
web/      React UI shell, wa-sqlite + IndexedDB persistence
tauri/    Tauri 2 wrapper — reuses web's UI with @tauri-apps/plugin-sql
pwa/      Capacitor 6 mobile shell — Android, native SQLite
```

`pnpm` workspace; Node ≥ 20.

## Quick start

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Web (debug)

```bash
pnpm dev:web
```

Opens `http://localhost:5173/`. Persistence via wa-sqlite + IndexedDB. Use Settings → Demo to load 50 sample contacts.

## Tauri (desktop)

### Prerequisites

Tauri 2 requires the Rust toolchain on the host machine (the `pnpm` package alone is not enough). Follow the platform-specific guide at <https://v2.tauri.app/start/prerequisites/>:

- **Linux**: build-essential, libwebkit2gtk-4.1-dev, libssl-dev, libgtk-3-dev, libayatana-appindicator3-dev, librsvg2-dev.
- **macOS**: Xcode Command Line Tools.
- **Windows**: Microsoft Visual Studio C++ Build Tools + WebView2.

Then install Rust:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Dev

```bash
pnpm dev:tauri          # frontend Vite dev server only (port 1420)
pnpm --filter @smart-contacts/tauri tauri dev   # full Tauri shell (Rust + WebView)
```

The first `tauri dev` invocation downloads and compiles Rust dependencies — expect 5-10 minutes. Subsequent runs are incremental.

### Build

```bash
pnpm --filter @smart-contacts/tauri tauri build
```

Output:

- Linux: `tauri/src-tauri/target/release/bundle/{deb,appimage}/`
- macOS: `tauri/src-tauri/target/release/bundle/{dmg,macos}/`
- Windows: `tauri/src-tauri/target/release/bundle/{msi,nsis}/`

### What works

- All web features: contacts CRUD, network dashboard, bulk operations, undo/redo, hidden/protected flags, demo data, theme.
- Native menu: File → Export… / Import…, Edit → Undo / Redo / Copy / Paste.
- Native file-picker for backup export/import (replaces browser blob/upload).
- SQLite persistence in user data dir (`~/.local/share/smart-contacts.db` on Linux; analogous paths on macOS/Windows).

### Smoke checklist

1. Launch app — window opens with the same UI as web.
2. Add a contact, edit, delete — verify state persists across relaunch.
3. Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo.
4. File → Export → native save dialog → JSON file written.
5. File → Import → native open dialog → contacts merged.
6. Quit and relaunch — contacts persist (native SQLite, not IndexedDB).

## PWA (mobile, Android)

See `docs/superpowers/plans/2026-05-02-p11-pwa-mobile.md` (P11) for the in-progress plan. Build instructions land in P11.T8.

## Architecture notes

- DB persistence is abstracted behind `DbAdapter` (`shared/src/db/adapter.ts`). Each target supplies its own implementation — `wa-sqlite-backend.ts` (web), `tauri-sql-backend.ts` (tauri), `capacitor-sql-backend.ts` (pwa).
- `SmartContactsShell` (`web/src/SmartContactsApp.tsx`) accepts a `DbState` prop, so the same React tree drives all three targets.
- Sync runs only while the app is open (per spec §22.6); no background scheduler.
- All migrations are JS-side via `applyMigrations(db)`; we do NOT use Tauri's Rust-side migration registration.

## Contributing / agent runs

- All commits English. No "Co-Authored-By: Claude" attribution.
- Plans live in `docs/superpowers/plans/`, specs in `docs/superpowers/specs/`.
- Tests: `pnpm test` (vitest in `shared/`).
- Lint/format: `pnpm lint` (eslint + prettier).
