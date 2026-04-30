# Smart Contacts — Plan P1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a workable monorepo (`shared/`, `web/`, `pwa/`) with the storage layer, themes, i18n, and shell UIs, so subsequent plans (P2 CRUD, P3 QuickEntry, P4 device sync, P5 Google integration, P6 PWA mobile) can land features against a stable foundation.

**Architecture:** TypeScript monorepo with three Vite projects sharing one `shared/` library. `shared/db` exposes a `db-like` adapter (`select`, `execute`, `transaction`) implemented over `wa-sqlite` with persistence in IndexedDB; the same shape will accept a Tauri `@tauri-apps/plugin-sql` backend later without touching `shared/sync` or `shared/core`. Themes, i18n, and ULID are direct ports from TaskOrchestrator (`/workspace/TaskOrchestrator-main/`).

**Tech Stack:** TypeScript 5 strict, React 18, Tailwind, lucide-react, Vite, Vitest, jsdom, fake-indexeddb, wa-sqlite, vite-plugin-pwa, ESLint with `react-hooks`, Prettier, Husky + lint-staged, GitHub Actions.

**Reference:** `/workspace/TaskOrchestrator-main/` is read-only; copy with `tasks → contacts` substitution for ports.

**Spec:** `docs/superpowers/specs/2026-04-29-contacts-app-design.md` (this plan implements §2, §3 schema, §8 shell only, §9 General/About tabs only, §11 deploy scaffolding).

---

## Task 1: Initialize repo and move docs

**Files:**
- Create: `/workspace/ContactsGit/` repo (git init)
- Move: `/workspace/docs/superpowers/specs/2026-04-29-contacts-app-design.md` → `/workspace/ContactsGit/docs/superpowers/specs/`
- Move: `/workspace/docs/superpowers/plans/2026-04-29-p1-foundation.md` → `/workspace/ContactsGit/docs/superpowers/plans/`
- Create: `/workspace/ContactsGit/.gitignore`, `LICENSE`, `README.md`, `README.ru.md`

- [ ] **Step 1: Init git in `/workspace/ContactsGit`**

```bash
cd /workspace/ContactsGit
git init -b main
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
node_modules/
dist/
.vite/
coverage/
.DS_Store
*.log
.env
.env.local
.env.*.local
.idea/
.vscode/
!.vscode/extensions.json
*.swp
.cache/
playwright-report/
test-results/
```

- [ ] **Step 3: Move docs into the repo and add a `LICENSE` (MIT)**

```bash
mkdir -p /workspace/ContactsGit/docs/superpowers/specs
mkdir -p /workspace/ContactsGit/docs/superpowers/plans
mv /workspace/docs/superpowers/specs/2026-04-29-contacts-app-design.md /workspace/ContactsGit/docs/superpowers/specs/
mv /workspace/docs/superpowers/plans/2026-04-29-p1-foundation.md /workspace/ContactsGit/docs/superpowers/plans/
```

Write `LICENSE` (MIT, year 2026, holder: project owner — leave empty placeholder line `Copyright (c) 2026 <Owner>`).

- [ ] **Step 4: Stub `README.md` and `README.ru.md`**

`README.md`:
```markdown
# Smart Contacts

Decentralized, offline-first contact manager. Browser PWA + desktop SPA now; Tauri later.

See `docs/superpowers/specs/2026-04-29-contacts-app-design.md` for the full design.
```

`README.ru.md`:
```markdown
# Smart Contacts

Децентрализованный оффлайн-first менеджер контактов. На текущей фазе — браузерное PWA + desktop SPA, далее — Tauri.

Полное описание: `docs/superpowers/specs/2026-04-29-contacts-app-design.md`.
```

- [ ] **Step 5: First commit**

```bash
cd /workspace/ContactsGit
git add .gitignore LICENSE README.md README.ru.md docs/
git commit -m "chore: initialize repo and import design docs"
```

---

## Task 2: Monorepo layout + root `package.json`

> **Carry-forward from P1.T1 code review:** Before running `pnpm install` for the first time, extend `.gitignore` with `.pnpm-store/`, `.eslintcache`, and `.husky/_` so artifacts produced by Husky's bootstrap and ESLint's `--cache` do not leak into commits. Reason: the original `.gitignore` was authored before these tools existed in the repo. Apply via Step 0 below.

**Files:**
- Modify: `.gitignore` (extend per Step 0)
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`
- Create dirs: `shared/`, `web/`, `pwa/`, `scripts/`

- [ ] **Step 0: Extend `.gitignore` with tooling-cache entries (carry-forward from P1.T1)**

Append to `.gitignore`:
```
.pnpm-store/
.eslintcache
.husky/_
```

- [ ] **Step 1: Decide package manager: pnpm. Create workspace file.**

`pnpm-workspace.yaml`:
```yaml
packages:
  - shared
  - web
  - pwa
```

- [ ] **Step 2: Root `package.json`**

```json
{
  "name": "smart-contacts",
  "private": true,
  "version": "0.0.1",
  "scripts": {
    "lint": "pnpm -r --parallel lint",
    "typecheck": "pnpm -r --parallel typecheck",
    "test": "pnpm -r --parallel test",
    "build": "pnpm -r --parallel build",
    "dev:web": "pnpm --filter @smart-contacts/web dev",
    "dev:pwa": "pnpm --filter @smart-contacts/pwa dev"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@typescript-eslint/parser": "^7.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "eslint": "^8.57.0",
    "eslint-plugin-react": "^7.34.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "prettier": "^3.2.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.2.0"
  },
  "engines": { "node": ">=20" },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"]
  }
}
```

- [ ] **Step 3: `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "useDefineForClassFields": true,
    "verbatimModuleSyntax": false,
    "forceConsistentCasingInFileNames": true,
    "paths": {
      "@shared/*": ["./shared/src/*"]
    }
  }
}
```

- [ ] **Step 4: Root `tsconfig.json` (project references)**

```json
{
  "files": [],
  "references": [
    { "path": "./shared" },
    { "path": "./web" },
    { "path": "./pwa" }
  ]
}
```

- [ ] **Step 5: `.eslintrc.cjs` and `.prettierrc`**

`.eslintrc.cjs`:
```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react-hooks/exhaustive-deps': 'error',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
  settings: { react: { version: '18' } },
  ignorePatterns: ['dist', 'node_modules', 'coverage'],
}
```

`.prettierrc`:
```json
{ "semi": false, "singleQuote": true, "trailingComma": "all", "printWidth": 100 }
```

- [ ] **Step 6: Husky pre-commit**

```bash
pnpm dlx husky-init && pnpm install
echo "pnpm lint-staged" > .husky/pre-commit
```

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json tsconfig.json .eslintrc.cjs .prettierrc .husky/
git commit -m "chore: scaffold monorepo with pnpm + TS strict + ESLint + Husky"
```

---

## Task 3: `shared/` package skeleton

> **Carry-forward from P1.T2 code review:** Before completing this task, extend root `.eslintrc.cjs` with an `env` block (`browser: true, es2022: true`). Without it, `eslint:recommended` will fire `no-undef` on every browser global (`window`, `document`, `localStorage`, …) once T12/T13 introduce React code. Apply via Step 0 below.

**Files:**
- Modify: `.eslintrc.cjs` (extend per Step 0)
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`, `shared/src/index.ts`

- [ ] **Step 0: Extend `.eslintrc.cjs` with `env` (carry-forward from P1.T2)**

In `.eslintrc.cjs`, add immediately after `parserOptions: { ... }`:

```js
  env: { browser: true, es2022: true, node: true },
```

`node: true` is added to keep `module.exports` and `require` recognized inside `.cjs` config files themselves (and any future build scripts).

- [ ] **Step 1: `shared/package.json`**

```json
{
  "name": "@smart-contacts/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "lint": "eslint 'src/**/*.{ts,tsx}'",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -b"
  },
  "dependencies": {
    "wa-sqlite": "^0.9.13"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "vitest": "^1.5.0",
    "@vitest/coverage-v8": "^1.5.0",
    "fake-indexeddb": "^5.0.0",
    "jsdom": "^24.0.0"
  }
}
```

- [ ] **Step 2: `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `shared/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
    coverage: { reporter: ['text', 'html'], include: ['src/**'] },
  },
})
```

- [ ] **Step 4: `shared/src/test-setup.ts`**

```ts
import 'fake-indexeddb/auto'
```

- [ ] **Step 5: `shared/src/index.ts` (empty for now)**

```ts
export {}
```

- [ ] **Step 6: Run typecheck and tests (must pass with no tests)**

```bash
pnpm install
pnpm --filter @smart-contacts/shared typecheck
pnpm --filter @smart-contacts/shared test
```

Expected: typecheck PASS, vitest reports `No test files found` (this is a pass for now).

- [ ] **Step 7: Commit**

```bash
git add shared/
git commit -m "chore: scaffold shared/ package"
```

---

## Task 4: Port ULID generator with TDD

**Files:**
- Reference: `/workspace/TaskOrchestrator-main/tauri-app/src/ulid.ts` (27 lines)
- Reference test: `/workspace/TaskOrchestrator-main/tauri-app/src/ulid.test.ts`
- Create: `shared/src/ulid.ts`, `shared/src/ulid.test.ts`

- [ ] **Step 1: Write the failing test**

`shared/src/ulid.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { ulid } from './ulid'

describe('ulid', () => {
  test('produces 26-char Crockford-base32 string', () => {
    const id = ulid()
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })
  test('produces monotonically non-decreasing values within the same ms', () => {
    const ids = Array.from({ length: 100 }, () => ulid())
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })
  test('produces unique values across 1000 calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => ulid()))
    expect(set.size).toBe(1000)
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
pnpm --filter @smart-contacts/shared test ulid
```

Expected: `Cannot find module './ulid'`.

- [ ] **Step 3: Port `ulid.ts` from TaskOrchestrator**

Read `/workspace/TaskOrchestrator-main/tauri-app/src/ulid.ts` and copy to `shared/src/ulid.ts` with no changes.

- [ ] **Step 4: Run test, verify PASS**

```bash
pnpm --filter @smart-contacts/shared test ulid
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add shared/src/ulid.ts shared/src/ulid.test.ts
git commit -m "feat(shared): port ULID generator from TaskOrchestrator"
```

---

## Task 5: Define core types (`Contact`, `CustomFieldDef`, `VectorClock`, `SyncPackage`)

**Files:**
- Create: `shared/src/types.ts`

- [ ] **Step 1: Write `shared/src/types.ts`**

```ts
// Domain types for Smart Contacts.
// Multi-valued fields are JSON-serialized in DB columns; in TS they are arrays/objects.

export interface Phone { value: string; type?: string; primary?: boolean }
export interface Email { value: string; type?: string; primary?: boolean }
export interface PostalAddress {
  street?: string; city?: string; region?: string;
  postal?: string; country?: string; type?: string; primary?: boolean
}
export interface CalendarEvent { date: string; type: 'birthday' | 'anniversary' | 'custom' }
export interface Organization {
  name?: string; title?: string; department?: string;
  startDate?: string | null; endDate?: string | null; current?: boolean
}
export interface Url { value: string; type?: string }
export interface ImClient { protocol: string; handle: string }
export interface ExternalRelation { person: string; type?: string }
export interface InternalRelation { contactId: string; type?: string }
export interface GroupMembership { id: string; name?: string }
export interface SocialDetected { platform: string; handle: string }
export interface Reminder { id: string; date: string; text: string; done?: boolean }

export type CustomFieldType = 'text' | 'date' | 'number' | 'url' | 'boolean' | 'select'

export interface CustomFieldDef {
  id: string; name: string; type: CustomFieldType;
  options?: string[];
  createdAt: string; updatedAt: string; deletedAt?: string | null;
  lamportTs: number; deviceId: string;
}

export interface Contact {
  id: string;
  // Names
  givenName?: string; familyName?: string; middleName?: string;
  honorificPrefix?: string; honorificSuffix?: string;
  phoneticGiven?: string; phoneticFamily?: string;
  displayName?: string; nickname?: string;
  // Multi-valued
  phones?: Phone[]; emails?: Email[]; addresses?: PostalAddress[];
  events?: CalendarEvent[]; organizations?: Organization[];
  urls?: Url[]; imClients?: ImClient[];
  relationsExternal?: ExternalRelation[]; groups?: GroupMembership[];
  // Single-valued
  notesMd?: string; userDefined?: Record<string, string>;
  locale?: string; gender?: string; occupation?: string;
  // Extensions
  tags?: string[];
  relationsInternal?: InternalRelation[];
  customFields?: Record<string, string | number | boolean | null>;
  lastContactedAt?: string | null;
  preferredChannel?: string;
  priority?: number;
  socialDetected?: SocialDetected[];
  reminders?: Reminder[];
  // Google integration
  googleResourceName?: string | null;
  googleEtag?: string | null;
  googleLastSyncedAt?: string | null;
  // Avatar pointer
  avatarHash?: string | null;
  // Sync metadata
  createdAt: string; updatedAt: string; deletedAt?: string | null;
  lamportTs: number; deviceId: string;
}

export interface VectorClock { [deviceId: string]: number }

export interface AvatarBlob { contactId: string; mime: string; hash: string; blobBase64: string }

export interface SyncPackage {
  type: 'sync_package';
  deviceId: string | null;
  vectorClock: VectorClock;
  contacts: Contact[];
  customFieldDefs: CustomFieldDef[];
  avatars?: AvatarBlob[];
  settings?: Record<string, string>;
}

export interface SyncRequest {
  type: 'sync_request';
  deviceId: string | null;
  vectorClock: VectorClock;
}
```

- [ ] **Step 2: Re-export from `index.ts`**

`shared/src/index.ts`:
```ts
export * from './types'
export * from './ulid'
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @smart-contacts/shared typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add shared/src/types.ts shared/src/index.ts
git commit -m "feat(shared): define Contact / CustomFieldDef / SyncPackage types"
```

---

## Task 6: db-like adapter contract

**Files:**
- Create: `shared/src/db/adapter.ts`

- [ ] **Step 1: Write the contract**

`shared/src/db/adapter.ts`:
```ts
// db-like adapter — same shape as the `db` argument in TaskOrchestrator's
// tauri-app/src/store/sync.ts. Implementations must be transactional under
// `transaction()` and otherwise auto-commit per call.

export interface DbAdapter {
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<void>
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>
  close(): Promise<void>
}
```

- [ ] **Step 2: Re-export and typecheck**

Add to `shared/src/index.ts`:
```ts
export * from './db/adapter'
```

```bash
pnpm --filter @smart-contacts/shared typecheck
```

- [ ] **Step 3: Commit**

```bash
git add shared/src/db/adapter.ts shared/src/index.ts
git commit -m "feat(shared/db): define DbAdapter contract"
```

---

## Task 7: SQL schema migrations + tests

**Files:**
- Create: `shared/src/db/migrations.ts`, `shared/src/db/migrations.test.ts`

- [ ] **Step 1: Write the test (uses an in-memory mock adapter to verify DDL execution and idempotency)**

`shared/src/db/migrations.test.ts`:
```ts
import { describe, expect, test, beforeEach } from 'vitest'
import { applyMigrations, CURRENT_SCHEMA_VERSION } from './migrations'
import type { DbAdapter } from './adapter'

function mockAdapter(): DbAdapter & { executed: string[] } {
  const executed: string[] = []
  let metaVersion: number | null = null
  const adapter: DbAdapter & { executed: string[] } = {
    executed,
    async select(sql) {
      if (sql.includes("FROM meta WHERE key='schema_version'")) {
        return metaVersion === null ? [] : [{ value: String(metaVersion) }]
      }
      return []
    },
    async execute(sql, params) {
      executed.push(sql.trim().split('\n')[0])
      const m = sql.match(/INSERT INTO meta.*'schema_version'.*'(\d+)'/) ||
                sql.match(/UPDATE meta SET value='(\d+)' WHERE key='schema_version'/)
      if (m) metaVersion = Number(m[1])
      void params
    },
    async transaction(fn) { return fn(adapter) },
    async close() {},
  }
  return adapter
}

describe('migrations', () => {
  let db: ReturnType<typeof mockAdapter>
  beforeEach(() => { db = mockAdapter() })

  test('applies all DDL on a fresh DB and writes schema_version', async () => {
    await applyMigrations(db)
    const ddl = db.executed.join('\n')
    expect(ddl).toMatch(/CREATE TABLE.*contacts/)
    expect(ddl).toMatch(/CREATE TABLE.*custom_field_defs/)
    expect(ddl).toMatch(/CREATE TABLE.*vector_clock/)
    expect(ddl).toMatch(/CREATE TABLE.*avatars/)
    expect(ddl).toMatch(/CREATE TABLE.*meta/)
    expect(ddl).toMatch(/CREATE TABLE.*sync_log/)
    const versionRow = await db.select<{ value: string }>("SELECT value FROM meta WHERE key='schema_version'")
    expect(versionRow[0]?.value).toBe(String(CURRENT_SCHEMA_VERSION))
  })

  test('is idempotent: second call does not re-run DDL', async () => {
    await applyMigrations(db)
    const firstCount = db.executed.length
    await applyMigrations(db)
    expect(db.executed.length).toBe(firstCount)
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
pnpm --filter @smart-contacts/shared test migrations
```

Expected: `Cannot find module './migrations'`.

- [ ] **Step 3: Implement migrations**

`shared/src/db/migrations.ts`:
```ts
import type { DbAdapter } from './adapter'

export const CURRENT_SCHEMA_VERSION = 1

const v1 = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS vector_clock (
     device_id TEXT PRIMARY KEY, counter INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS contacts (
     id                  TEXT PRIMARY KEY,
     given_name          TEXT, family_name TEXT, middle_name TEXT,
     honorific_prefix    TEXT, honorific_suffix TEXT,
     phonetic_given      TEXT, phonetic_family TEXT,
     display_name        TEXT,
     nickname            TEXT,
     phones              TEXT, emails TEXT, addresses TEXT,
     events              TEXT, organizations TEXT,
     urls                TEXT, im_clients TEXT,
     relations_external  TEXT, groups TEXT,
     notes_md            TEXT, user_defined TEXT,
     locale              TEXT, gender TEXT, occupation TEXT,
     tags                TEXT,
     relations_internal  TEXT,
     custom_fields       TEXT,
     last_contacted_at   TEXT,
     preferred_channel   TEXT,
     priority            INTEGER,
     social_detected     TEXT,
     reminders           TEXT,
     google_resource_name TEXT, google_etag TEXT, google_last_synced_at TEXT,
     avatar_hash         TEXT,
     created_at          TEXT NOT NULL,
     updated_at          TEXT NOT NULL,
     deleted_at          TEXT,
     lamport_ts          INTEGER NOT NULL,
     device_id           TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS contacts_did_lts ON contacts(device_id, lamport_ts)`,
  `CREATE INDEX IF NOT EXISTS contacts_display ON contacts(display_name)`,
  `CREATE INDEX IF NOT EXISTS contacts_google  ON contacts(google_resource_name)`,
  `CREATE TABLE IF NOT EXISTS custom_field_defs (
     id TEXT PRIMARY KEY, name TEXT NOT NULL,
     type TEXT NOT NULL CHECK(type IN ('text','date','number','url','boolean','select')),
     options TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
     lamport_ts INTEGER NOT NULL, device_id TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS avatars (
     contact_id TEXT PRIMARY KEY,
     blob       BLOB NOT NULL, mime TEXT NOT NULL,
     source_url TEXT, fetched_at TEXT NOT NULL, hash TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS tags_index   (name TEXT PRIMARY KEY)`,
  `CREATE TABLE IF NOT EXISTS groups_index (id TEXT PRIMARY KEY, name TEXT)`,
  `CREATE TABLE IF NOT EXISTS sync_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     entity TEXT, entity_id TEXT, action TEXT,
     device_id TEXT, lamport_ts INTEGER, data TEXT,
     created_at TEXT NOT NULL
   )`,
]

export async function applyMigrations(db: DbAdapter): Promise<void> {
  const rows = await db.select<{ value: string }>(
    "SELECT value FROM meta WHERE key='schema_version'",
  )
  const current = rows[0] ? Number(rows[0].value) : 0
  if (current >= CURRENT_SCHEMA_VERSION) return

  await db.transaction(async (tx) => {
    if (current < 1) {
      for (const stmt of v1) await tx.execute(stmt)
    }
    if (current === 0) {
      await tx.execute(
        `INSERT INTO meta (key, value) VALUES ('schema_version', '${CURRENT_SCHEMA_VERSION}')`,
      )
    } else {
      await tx.execute(
        `UPDATE meta SET value='${CURRENT_SCHEMA_VERSION}' WHERE key='schema_version'`,
      )
    }
  })
}
```

- [ ] **Step 4: Run test, verify PASS**

```bash
pnpm --filter @smart-contacts/shared test migrations
```

Expected: 2 tests pass.

- [ ] **Step 5: Re-export from `index.ts`**

```ts
export * from './db/migrations'
```

- [ ] **Step 6: Commit**

```bash
git add shared/src/db/migrations.ts shared/src/db/migrations.test.ts shared/src/index.ts
git commit -m "feat(shared/db): schema migrations v1 with idempotency test"
```

---

## Task 8: wa-sqlite backend with IndexedDB persistence

> **Carry-forward from P1.T3 implementation:** `wa-sqlite@^0.9.13` is unavailable on npm; only `1.0.0` is published. T3 installed `^1.0.0`. The 1.0 API may differ from what the code skeleton in this task assumes (it was sketched against the 0.9 surface). Before writing implementation code, **inspect the installed package** at `node_modules/wa-sqlite/dist/wa-sqlite.mjs` and the package's README/types, and adapt the binding helpers (`bind_*`, `column_*`, `serialize`, `deserialize`, `SQLITE_DESERIALIZE_*` constants) to whatever the 1.0 API actually exposes. The adapter shape (`select` / `execute` / `transaction` / `close`) and the snapshot-flush logic stay valid regardless of API differences.
>
> **Carry-forward from P1.T7 code review (Important):** The unit test for `applyMigrations` uses a mock adapter that records SQL strings without executing them, so it cannot verify behavior on a *partially* migrated database (e.g. `meta.schema_version` missing but some tables already exist). Add an integration test in this task that runs `applyMigrations(db)` against a real wa-sqlite instance, drops `meta` (only) to simulate corruption, and asserts a second `applyMigrations(db)` succeeds and ends with `schema_version = CURRENT_SCHEMA_VERSION`.

**Files:**
- Create: `shared/src/db/wa-sqlite-backend.ts`, `shared/src/db/wa-sqlite-backend.test.ts`, `shared/src/db/snapshot-store.ts`

- [ ] **Step 1: Write the test (round-trip CRUD on a real wa-sqlite instance using fake-indexeddb for snapshot persistence)**

`shared/src/db/wa-sqlite-backend.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from './wa-sqlite-backend'
import { applyMigrations } from './migrations'
import { ulid } from '../ulid'

describe('wa-sqlite backend', () => {
  test('CRUD via select/execute round-trip', async () => {
    const db = await openWaSqliteAdapter('test-db')
    await applyMigrations(db)

    const id = ulid()
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO contacts (id, display_name, created_at, updated_at, lamport_ts, device_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, 'Иван', now, now, 1, 'DEV1'],
    )
    const rows = await db.select<{ id: string; display_name: string }>(
      'SELECT id, display_name FROM contacts WHERE id = ?', [id],
    )
    expect(rows[0]).toMatchObject({ id, display_name: 'Иван' })

    await db.execute('UPDATE contacts SET display_name = ? WHERE id = ?', ['Ivan', id])
    const after = await db.select<{ display_name: string }>(
      'SELECT display_name FROM contacts WHERE id = ?', [id],
    )
    expect(after[0]?.display_name).toBe('Ivan')

    await db.execute('DELETE FROM contacts WHERE id = ?', [id])
    const empty = await db.select('SELECT id FROM contacts WHERE id = ?', [id])
    expect(empty).toHaveLength(0)

    await db.close()
  })

  test('persists across reopen via IndexedDB snapshot', async () => {
    const db1 = await openWaSqliteAdapter('persist-db')
    await applyMigrations(db1)
    const id = ulid()
    const now = new Date().toISOString()
    await db1.execute(
      `INSERT INTO contacts (id, display_name, created_at, updated_at, lamport_ts, device_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, 'Persist', now, now, 1, 'DEV1'],
    )
    await db1.close()

    const db2 = await openWaSqliteAdapter('persist-db')
    const rows = await db2.select<{ display_name: string }>(
      'SELECT display_name FROM contacts WHERE id = ?', [id],
    )
    expect(rows[0]?.display_name).toBe('Persist')
    await db2.close()
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
pnpm --filter @smart-contacts/shared test wa-sqlite
```

Expected: `Cannot find module './wa-sqlite-backend'`.

- [ ] **Step 3: Implement snapshot store (IndexedDB get/put of a single Uint8Array)**

`shared/src/db/snapshot-store.ts`:
```ts
const DB_NAME = 'smart-contacts-snapshots'
const STORE = 'snapshots'

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadSnapshot(name: string): Promise<Uint8Array | null> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(name)
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function saveSnapshot(name: string, data: Uint8Array): Promise<void> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(data, name)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
```

- [ ] **Step 4: Implement wa-sqlite adapter**

`shared/src/db/wa-sqlite-backend.ts`:
```ts
import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — wa-sqlite has no shipped types for the API surface
import * as SQLite from 'wa-sqlite'
import type { DbAdapter } from './adapter'
import { loadSnapshot, saveSnapshot } from './snapshot-store'

interface OpenedHandle {
  sqlite3: any
  db: number
  name: string
  flushScheduled: boolean
}

const FLUSH_DEBOUNCE_MS = 250

async function exportToBytes(handle: OpenedHandle): Promise<Uint8Array> {
  // Serialize current DB to a byte buffer using sqlite3_serialize.
  const data = handle.sqlite3.serialize(handle.db, 'main')
  // wa-sqlite returns a JS Uint8Array view; copy to detach from internal memory.
  return new Uint8Array(data)
}

function scheduleFlush(handle: OpenedHandle): void {
  if (handle.flushScheduled) return
  handle.flushScheduled = true
  setTimeout(async () => {
    handle.flushScheduled = false
    const bytes = await exportToBytes(handle)
    await saveSnapshot(handle.name, bytes)
  }, FLUSH_DEBOUNCE_MS)
}

export async function openWaSqliteAdapter(name: string): Promise<DbAdapter> {
  const module = await SQLiteESMFactory()
  const sqlite3 = SQLite.Factory(module)

  const db = await sqlite3.open_v2(`:memory:`)
  const existing = await loadSnapshot(name)
  if (existing) {
    sqlite3.deserialize(db, 'main', existing, existing.byteLength, existing.byteLength,
      sqlite3.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.SQLITE_DESERIALIZE_RESIZEABLE)
  }

  const handle: OpenedHandle = { sqlite3, db, name, flushScheduled: false }

  const adapter: DbAdapter = {
    async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const rows: T[] = []
      const stmt = await sqlite3.prepare_v2(db, sql)
      try {
        for (let i = 0; i < params.length; i++) {
          const v = params[i]
          const idx = i + 1
          if (v === null || v === undefined) sqlite3.bind_null(stmt.stmt, idx)
          else if (typeof v === 'number') sqlite3.bind_double(stmt.stmt, idx, v)
          else if (typeof v === 'bigint') sqlite3.bind_int64(stmt.stmt, idx, v)
          else if (v instanceof Uint8Array) sqlite3.bind_blob(stmt.stmt, idx, v)
          else sqlite3.bind_text(stmt.stmt, idx, String(v))
        }
        while ((await sqlite3.step(stmt.stmt)) === sqlite3.SQLITE_ROW) {
          const row: Record<string, unknown> = {}
          const cols = sqlite3.column_count(stmt.stmt)
          for (let c = 0; c < cols; c++) {
            row[sqlite3.column_name(stmt.stmt, c)] = sqlite3.column(stmt.stmt, c)
          }
          rows.push(row as T)
        }
      } finally {
        await sqlite3.finalize(stmt.stmt)
      }
      return rows
    },
    async execute(sql: string, params: unknown[] = []): Promise<void> {
      const stmt = await sqlite3.prepare_v2(db, sql)
      try {
        for (let i = 0; i < params.length; i++) {
          const v = params[i]
          const idx = i + 1
          if (v === null || v === undefined) sqlite3.bind_null(stmt.stmt, idx)
          else if (typeof v === 'number') sqlite3.bind_double(stmt.stmt, idx, v)
          else if (typeof v === 'bigint') sqlite3.bind_int64(stmt.stmt, idx, v)
          else if (v instanceof Uint8Array) sqlite3.bind_blob(stmt.stmt, idx, v)
          else sqlite3.bind_text(stmt.stmt, idx, String(v))
        }
        while ((await sqlite3.step(stmt.stmt)) === sqlite3.SQLITE_ROW) {
          // SELECT-shaped queries should use `select`. Drain rows defensively.
        }
      } finally {
        await sqlite3.finalize(stmt.stmt)
      }
      scheduleFlush(handle)
    },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      await adapter.execute('BEGIN')
      try {
        const result = await fn(adapter)
        await adapter.execute('COMMIT')
        return result
      } catch (e) {
        await adapter.execute('ROLLBACK')
        throw e
      }
    },
    async close(): Promise<void> {
      const bytes = await exportToBytes(handle)
      await saveSnapshot(handle.name, bytes)
      await sqlite3.close(db)
    },
  }
  return adapter
}
```

> **Note:** wa-sqlite's exact symbol surface (`SQLITE_DESERIALIZE_*`, `bind_*`, `column`, `serialize`, `deserialize`) varies slightly across versions. If the imports above don't resolve at install time, consult `node_modules/wa-sqlite/dist/wa-sqlite.mjs` and adjust names. The `OpenedHandle` flush logic and the adapter shape are stable regardless.

- [ ] **Step 5: Run test, verify PASS**

```bash
pnpm --filter @smart-contacts/shared test wa-sqlite
```

Expected: 2 tests pass. If wa-sqlite API names differ, **fix names** (don't skip the test).

- [ ] **Step 6: Re-export from `index.ts`**

```ts
export * from './db/wa-sqlite-backend'
export * from './db/snapshot-store'
```

- [ ] **Step 7: Commit**

```bash
git add shared/src/db/
git commit -m "feat(shared/db): wa-sqlite backend with IndexedDB snapshot persistence"
```

---

## Task 9: Initialize device — `shared/src/db/init.ts`

> **Carry-forward from P1.T4 code review (Minor):** Add a millisecond-boundary test to `shared/src/ulid.test.ts`: generate a batch, sleep ~2 ms, generate another batch, assert uniqueness across both batches and `before.last < after.first` (timestamp ordering). Without this test, a regression in `_lastTime` reset logic on ms transitions would not be caught — a likely source of hard-to-reproduce duplicate-ID bugs once `ulid()` is the sole ID source for contacts/devices/custom-fields. Add as Step 0 below before continuing with the device-init work.
>
> **Carry-forward from P1.T8 code review (Important — testing):** The new `init.test.ts` calls `openWaSqliteAdapter`, which loads a WASM binary. jsdom cannot instantiate WASM streams. The test file MUST start with the `// @vitest-environment node` directive and `import 'fake-indexeddb/auto'` BEFORE any other imports — match the pattern already used in `shared/src/db/wa-sqlite-backend.test.ts`.

**Files:**
- Modify: `shared/src/ulid.test.ts` (per Step 0)
- Create: `shared/src/db/init.ts`, `shared/src/db/init.test.ts`

- [ ] **Step 0: Add ms-boundary regression test to `shared/src/ulid.test.ts` (carry-forward from P1.T4)**

Append inside the existing `describe('ulid', ...)` block:

```ts
test('ULIDs generated across a ms boundary remain unique and ordered', async () => {
  const before = Array.from({ length: 50 }, () => ulid())
  await new Promise((r) => setTimeout(r, 2))
  const after = Array.from({ length: 50 }, () => ulid())
  const all = [...before, ...after]
  expect(new Set(all).size).toBe(100)
  expect(before[49]! < after[0]!).toBe(true)
})
```

Run `pnpm --filter @smart-contacts/shared test ulid` and verify all 4 tests pass before continuing with Step 1.

- [ ] **Step 1: Write the test**

`shared/src/db/init.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { openWaSqliteAdapter } from './wa-sqlite-backend'
import { applyMigrations } from './migrations'
import { initDevice, getDeviceId } from './init'

describe('initDevice', () => {
  test('writes a stable device_id and an initial vector_clock entry', async () => {
    const db = await openWaSqliteAdapter('init-test-1')
    await applyMigrations(db)
    await initDevice(db)
    const did = await getDeviceId(db)
    expect(did).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    const vc = await db.select<{ device_id: string; counter: number }>('SELECT * FROM vector_clock')
    expect(vc).toEqual([{ device_id: did, counter: 0 }])
    await db.close()

    // Reopen, device_id must persist
    const db2 = await openWaSqliteAdapter('init-test-1')
    await applyMigrations(db2)
    await initDevice(db2)
    expect(await getDeviceId(db2)).toBe(did)
    await db2.close()
  })
})
```

- [ ] **Step 2: Verify it fails**

```bash
pnpm --filter @smart-contacts/shared test init
```

- [ ] **Step 3: Implement**

`shared/src/db/init.ts`:
```ts
import type { DbAdapter } from './adapter'
import { ulid } from '../ulid'

export async function initDevice(db: DbAdapter): Promise<void> {
  const rows = await db.select<{ value: string }>(
    "SELECT value FROM meta WHERE key='device_id'",
  )
  if (rows.length > 0) return
  const deviceId = ulid()
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO meta (key, value) VALUES ('device_id', ?)`,
      [deviceId],
    )
    await tx.execute(
      `INSERT INTO vector_clock (device_id, counter) VALUES (?, 0)`,
      [deviceId],
    )
  })
}

export async function getDeviceId(db: DbAdapter): Promise<string> {
  const rows = await db.select<{ value: string }>(
    "SELECT value FROM meta WHERE key='device_id'",
  )
  if (!rows[0]) throw new Error('Device not initialized; call initDevice() first.')
  return rows[0].value
}
```

- [ ] **Step 4: Verify PASS, commit**

```bash
pnpm --filter @smart-contacts/shared test init
git add shared/src/db/init.ts shared/src/db/init.test.ts
git commit -m "feat(shared/db): device initialization and stable device_id"
```

---

## Task 10: Port themes from TaskOrchestrator

**Files:**
- Reference: `/workspace/TaskOrchestrator-main/tauri-app/src/core/themes.ts`
- Create: `shared/src/themes/themes.ts`, `shared/src/themes/index.ts`

- [ ] **Step 1: Copy the reference file verbatim**

Read `/workspace/TaskOrchestrator-main/tauri-app/src/core/themes.ts` and copy its contents into `shared/src/themes/themes.ts`. Keep `COLOR_THEMES` and `buildTC()` exactly as-is.

- [ ] **Step 2: `shared/src/themes/index.ts`**

```ts
export * from './themes'
```

- [ ] **Step 3: Re-export from `shared/src/index.ts`**

```ts
export * as themes from './themes'
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @smart-contacts/shared typecheck
```

If imports inside `themes.ts` reference TaskOrchestrator-specific paths, fix them locally; the file should otherwise be self-contained.

- [ ] **Step 5: Commit**

```bash
git add shared/src/themes/ shared/src/index.ts
git commit -m "feat(shared/themes): port default + gruvbox themes from TaskOrchestrator"
```

---

## Task 11: Port i18n from TaskOrchestrator

**Files:**
- Reference: `/workspace/TaskOrchestrator-main/shared/i18n/` and `/workspace/TaskOrchestrator-main/tauri-app/src/i18n/`
- Create: `shared/src/i18n/index.ts`, `shared/src/i18n/en.ts`, `shared/src/i18n/ru.ts`, `shared/src/i18n/use-translation.ts`

- [ ] **Step 1: Inspect reference i18n shape**

```bash
ls /workspace/TaskOrchestrator-main/shared/i18n/
ls /workspace/TaskOrchestrator-main/tauri-app/src/i18n/
```

Identify the dictionary file shape (key → string) and the hook used (`useTranslation`).

- [ ] **Step 2: Create skeleton dictionaries with only the keys needed by the shell UIs in this plan**

`shared/src/i18n/en.ts`:
```ts
export const en = {
  app: { title: 'Smart Contacts' },
  status: { contacts: '{count} contacts' },
  theme: { light: 'Light', dark: 'Dark' },
  density: { compact: 'Compact', comfortable: 'Comfortable' },
  settings: { title: 'Settings', tabs: { general: 'General', about: 'About' } },
}
export type Dict = typeof en
```

`shared/src/i18n/ru.ts`:
```ts
import type { Dict } from './en'
export const ru: Dict = {
  app: { title: 'Smart Contacts' },
  status: { contacts: '{count} контактов' },
  theme: { light: 'Светлая', dark: 'Тёмная' },
  density: { compact: 'Плотно', comfortable: 'Свободно' },
  settings: { title: 'Настройки', tabs: { general: 'Общее', about: 'О программе' } },
}
```

`shared/src/i18n/index.ts`:
```ts
import { en } from './en'
import { ru } from './ru'

export type Locale = 'en' | 'ru'
export const dictionaries = { en, ru }

export function t(loc: Locale, path: string, vars?: Record<string, string | number>): string {
  const parts = path.split('.')
  let cur: unknown = dictionaries[loc]
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else return path
  }
  let s = typeof cur === 'string' ? cur : path
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  return s
}
```

- [ ] **Step 3: Test**

`shared/src/i18n/i18n.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { t } from './index'

describe('i18n', () => {
  test('returns the right string per locale and substitutes vars', () => {
    expect(t('en', 'status.contacts', { count: 3 })).toBe('3 contacts')
    expect(t('ru', 'status.contacts', { count: 3 })).toBe('3 контактов')
  })
  test('returns the path when key is missing', () => {
    expect(t('en', 'no.such.key')).toBe('no.such.key')
  })
})
```

- [ ] **Step 4: Run, verify PASS, commit**

```bash
pnpm --filter @smart-contacts/shared test i18n
git add shared/src/i18n/
git commit -m "feat(shared/i18n): minimal EN/RU dictionaries for shell UIs"
```

---

## Task 12: `web/` shell — empty layout with theme switcher and contacts count

> **Carry-forward from P1.T3 code review:**
> 1. **Verify `@shared/*` Vite alias resolves correctly.** `shared/package.json` intentionally sets `main: ./src/index.ts` (TypeScript source, not built `dist/`). Web/PWA never consume the package via Node `main` — only via Vite's TypeScript path alias. Confirm in this task that Vite resolves `@shared/themes/themes`, `@shared/db/...`, `@shared/i18n` correctly at dev-run time (visit the page, see no resolution errors).
> 2. **Scope ESLint `node` env for browser code.** Root `.eslintrc.cjs` has `env: { ..., node: true }` (carry-forward from T2). Browser-only code in `web/src/**` should not see Node globals. As part of this task, add an `overrides` block to root `.eslintrc.cjs`:
>
>    ```js
>    overrides: [
>      { files: ['web/src/**', 'pwa/src/**'], env: { node: false, browser: true } },
>    ],
>    ```
>
>    Adjust formatting to fit existing config style.

**Files:**
- Modify: `.eslintrc.cjs` (per carry-forward 2 above)
- Create: `web/package.json`, `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/tailwind.config.ts`, `web/postcss.config.cjs`, `web/src/main.tsx`, `web/src/SmartContactsApp.tsx`, `web/src/app.css`, `web/src/ui/Sidebar.tsx`, `web/src/ui/MainList.tsx`, `web/src/ui/StatusBar.tsx`, `web/src/ui/AppContext.tsx`, `web/src/store/useDb.ts`

- [ ] **Step 1: `web/package.json`**

```json
{
  "name": "@smart-contacts/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview --port 4173",
    "lint": "eslint 'src/**/*.{ts,tsx}'",
    "typecheck": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@smart-contacts/shared": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "lucide-react": "^0.396.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.5.0"
  }
}
```

- [ ] **Step 2: `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../shared/src') },
  },
  server: { port: 5173 },
})
```

- [ ] **Step 3: `web/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "jsx": "react-jsx",
    "paths": { "@shared/*": ["../shared/src/*"] }
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../shared" }]
}
```

- [ ] **Step 4: Tailwind + index.html + main.tsx**

`web/tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss'
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
```

`web/postcss.config.cjs`:
```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Smart Contacts</title>
  </head>
  <body class="m-0">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/app.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
html, body, #root { height: 100%; }
```

`web/src/main.tsx`:
```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import { SmartContactsApp } from './SmartContactsApp'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SmartContactsApp />
  </React.StrictMode>,
)
```

- [ ] **Step 5: AppContext + useDb (initializes the wa-sqlite adapter once)**

`web/src/ui/AppContext.tsx`:
```tsx
import { createContext, useContext, useMemo, useState, ReactNode } from 'react'
import type { Locale } from '@shared/i18n'

interface AppCtx {
  locale: Locale; setLocale: (l: Locale) => void
  mode: 'dark' | 'light'; setMode: (m: 'dark' | 'light') => void
  theme: 'default' | 'gruvbox'; setTheme: (t: 'default' | 'gruvbox') => void
  density: 'compact' | 'comfortable'; setDensity: (d: 'compact' | 'comfortable') => void
}

const Ctx = createContext<AppCtx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('ru')
  const [mode, setMode] = useState<'dark' | 'light'>('dark')
  const [theme, setTheme] = useState<'default' | 'gruvbox'>('default')
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable')
  const value = useMemo(
    () => ({ locale, setLocale, mode, setMode, theme, setTheme, density, setDensity }),
    [locale, mode, theme, density],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
```

`web/src/store/useDb.ts`:
```tsx
import { useEffect, useState } from 'react'
import type { DbAdapter } from '@shared/db/adapter'
import { openWaSqliteAdapter } from '@shared/db/wa-sqlite-backend'
import { applyMigrations } from '@shared/db/migrations'
import { initDevice, getDeviceId } from '@shared/db/init'

export function useDb() {
  const [db, setDb] = useState<DbAdapter | null>(null)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const adapter = await openWaSqliteAdapter('smart-contacts')
      await applyMigrations(adapter)
      await initDevice(adapter)
      const did = await getDeviceId(adapter)
      if (cancelled) { await adapter.close(); return }
      setDb(adapter); setDeviceId(did)
    })()
    return () => { cancelled = true }
  }, [])
  return { db, deviceId }
}
```

- [ ] **Step 6: SmartContactsApp + Sidebar + MainList + StatusBar**

`web/src/SmartContactsApp.tsx`:
```tsx
import { AppProvider, useApp } from './ui/AppContext'
import { Sidebar } from './ui/Sidebar'
import { MainList } from './ui/MainList'
import { StatusBar } from './ui/StatusBar'
import { useDb } from './store/useDb'
import { COLOR_THEMES } from '@shared/themes/themes'

function Inner() {
  const { theme, mode } = useApp()
  const tc = COLOR_THEMES[theme][mode]
  const { db } = useDb()
  return (
    <div className={`h-full flex flex-col ${tc.root}`}>
      <header className={`flex items-center px-4 h-12 border-b ${tc.borderClass} ${tc.header}`}>
        <h1 className="text-lg font-semibold">Smart Contacts</h1>
      </header>
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <MainList db={db} />
      </div>
      <StatusBar db={db} />
    </div>
  )
}

export function SmartContactsApp() {
  return <AppProvider><Inner /></AppProvider>
}
```

`web/src/ui/Sidebar.tsx`:
```tsx
import { useApp } from './AppContext'
import { COLOR_THEMES } from '@shared/themes/themes'

export function Sidebar() {
  const { theme, mode } = useApp()
  const tc = COLOR_THEMES[theme][mode]
  return (
    <aside className={`w-56 border-r ${tc.borderClass} ${tc.aside} p-3 text-sm`}>
      <div className={`${tc.textSec} uppercase tracking-wide text-xs mb-2`}>Filters</div>
      <ul className="space-y-1">
        <li className={`px-2 py-1 rounded ${tc.hoverBg}`}>All</li>
        <li className={`px-2 py-1 rounded ${tc.hoverBg}`}>Starred</li>
        <li className={`px-2 py-1 rounded ${tc.hoverBg}`}>Trash</li>
      </ul>
    </aside>
  )
}
```

`web/src/ui/MainList.tsx`:
```tsx
import type { DbAdapter } from '@shared/db/adapter'
import { useApp } from './AppContext'
import { COLOR_THEMES } from '@shared/themes/themes'

export function MainList({ db: _db }: { db: DbAdapter | null }) {
  const { theme, mode } = useApp()
  const tc = COLOR_THEMES[theme][mode]
  return (
    <main className={`flex-1 p-6 ${tc.surface}`}>
      <p className={`${tc.textSec}`}>No contacts yet. (Plan P2 will add CRUD.)</p>
    </main>
  )
}
```

`web/src/ui/StatusBar.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { DbAdapter } from '@shared/db/adapter'
import { useApp } from './AppContext'
import { COLOR_THEMES } from '@shared/themes/themes'
import { t } from '@shared/i18n'

export function StatusBar({ db }: { db: DbAdapter | null }) {
  const { theme, mode, locale, setMode, setTheme } = useApp()
  const tc = COLOR_THEMES[theme][mode]
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!db) return
    let cancelled = false
    ;(async () => {
      const rows = await db.select<{ c: number }>(
        'SELECT COUNT(*) AS c FROM contacts WHERE deleted_at IS NULL',
      )
      if (!cancelled) setCount(Number(rows[0]?.c ?? 0))
    })()
    return () => { cancelled = true }
  }, [db])
  return (
    <footer className={`flex items-center justify-between px-4 h-8 border-t ${tc.borderClass} ${tc.header} text-xs`}>
      <span className={tc.textSec}>{t(locale, 'status.contacts', { count })}</span>
      <span className="space-x-3">
        <button onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} className={tc.textSec}>
          {mode === 'dark' ? '☀' : '☾'}
        </button>
        <button onClick={() => setTheme(theme === 'default' ? 'gruvbox' : 'default')} className={tc.textSec}>
          theme
        </button>
      </span>
    </footer>
  )
}
```

- [ ] **Step 7: Run dev server and verify in browser via Chrome MCP**

```bash
pnpm install
pnpm --filter @smart-contacts/web dev
```

Open `http://localhost:5173` in the Chrome MCP tab (use `mcp__claude-in-chrome__tabs_create_mcp` then `navigate`). Expected: shell with header "Smart Contacts", sidebar with three filters, empty main, status bar showing `0 контактов`. Click theme/mode toggles — UI re-renders.

- [ ] **Step 8: Commit**

```bash
git add web/
git commit -m "feat(web): minimal shell with themes, i18n, and contacts count"
```

---

## Task 13: `pwa/` shell — single-pane layout + manifest + service worker

> **Carry-forward from P1.T3 code review:** `shared/package.json` sets `main: ./src/index.ts` (TS source, no `dist/` involved). Confirm Vite resolves `@shared/*` aliases correctly here too (the alias path is `../shared/src`, sibling-relative). The ESLint `overrides` block landed in T12 also covers `pwa/src/**`; nothing extra to do here for that.
>
> **Carry-forward from P1.T12 code review (Important):** Mirror two fixes from T12 in pwa/:
> 1. `pwa/tailwind.config.ts` `content` MUST include `'../shared/src/**/*.{ts,tsx}'` so dynamically-composed Tailwind class strings in `shared/themes/themes.ts` (gruvbox, custom hex) are not purged from production CSS.
> 2. If pwa/ uses a `useDb`-like hook, hold the adapter in a `useRef` and close it in cleanup. Without this the SQLite adapter leaks on every StrictMode double-mount and on every production unmount. Match the pattern in `web/src/store/useDb.ts`.

**Files:**
- Create: `pwa/package.json`, `pwa/index.html`, `pwa/vite.config.ts`, `pwa/tsconfig.json`, `pwa/tailwind.config.ts`, `pwa/postcss.config.cjs`, `pwa/src/main.tsx`, `pwa/src/MobileApp.tsx`, `pwa/src/app.css`, `pwa/public/icon-192.png`, `pwa/public/icon-512.png`

- [ ] **Step 1: `pwa/package.json` (mirror `web/`, add `vite-plugin-pwa`)**

```json
{
  "name": "@smart-contacts/pwa",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview --port 4174",
    "lint": "eslint 'src/**/*.{ts,tsx}'",
    "typecheck": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@smart-contacts/shared": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "lucide-react": "^0.396.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "vite": "^5.2.0",
    "vite-plugin-pwa": "^0.20.0",
    "vitest": "^1.5.0"
  }
}
```

- [ ] **Step 2: `pwa/vite.config.ts` (with PWA plugin)**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Smart Contacts',
        short_name: 'Contacts',
        description: 'Decentralized offline-first contact manager',
        theme_color: '#0ea5e9',
        background_color: '#111827',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared/src') } },
  server: { port: 5174 },
})
```

- [ ] **Step 3: `pwa/tsconfig.json` (mirror web)**

Same as `web/tsconfig.json` but with `outDir: "./dist"` distinct.

- [ ] **Step 4: Tailwind config, postcss, app.css — identical to web/.**

- [ ] **Step 5: `pwa/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0ea5e9" />
    <title>Smart Contacts</title>
  </head>
  <body class="m-0">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: `pwa/src/MobileApp.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { COLOR_THEMES } from '@shared/themes/themes'
import { t } from '@shared/i18n'
import { openWaSqliteAdapter } from '@shared/db/wa-sqlite-backend'
import { applyMigrations } from '@shared/db/migrations'
import { initDevice } from '@shared/db/init'
import type { DbAdapter } from '@shared/db/adapter'

export function MobileApp() {
  const tc = COLOR_THEMES.default.dark
  const [db, setDb] = useState<DbAdapter | null>(null)
  const [count, setCount] = useState(0)
  const [tab, setTab] = useState<'all' | 'starred' | 'settings'>('all')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const adapter = await openWaSqliteAdapter('smart-contacts')
      await applyMigrations(adapter)
      await initDevice(adapter)
      if (cancelled) { await adapter.close(); return }
      setDb(adapter)
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!db) return
    let cancelled = false
    ;(async () => {
      const rows = await db.select<{ c: number }>(
        'SELECT COUNT(*) AS c FROM contacts WHERE deleted_at IS NULL',
      )
      if (!cancelled) setCount(Number(rows[0]?.c ?? 0))
    })()
    return () => { cancelled = true }
  }, [db])

  return (
    <div className={`h-full flex flex-col ${tc.root}`}>
      <header className={`flex items-center justify-between px-4 h-12 border-b ${tc.borderClass} ${tc.header}`}>
        <h1 className="text-lg font-semibold">Smart Contacts</h1>
        <span className={`text-xs ${tc.textSec}`}>{t('ru', 'status.contacts', { count })}</span>
      </header>
      <main className={`flex-1 p-4 ${tc.surface}`}>
        {tab === 'all' && <p className={tc.textSec}>No contacts yet. (Plan P2.)</p>}
        {tab === 'starred' && <p className={tc.textSec}>Starred — empty.</p>}
        {tab === 'settings' && <p className={tc.textSec}>Settings — Plan P2.</p>}
      </main>
      <nav className={`flex border-t ${tc.borderClass} ${tc.header}`}>
        {(['all', 'starred', 'settings'] as const).map((k) => (
          <button key={k}
            onClick={() => setTab(k)}
            className={`flex-1 py-2 text-sm ${tab === k ? tc.text : tc.textSec}`}>
            {k === 'all' ? '👤 All' : k === 'starred' ? '⭐ Starred' : '⚙ Settings'}
          </button>
        ))}
      </nav>
    </div>
  )
}
```

- [ ] **Step 7: `pwa/src/main.tsx`**

```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import { MobileApp } from './MobileApp'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
)
```

- [ ] **Step 8: Placeholder PNGs**

Use any 192×192 and 512×512 solid-color PNG (e.g. `#0ea5e9`) for `pwa/public/icon-192.png` and `pwa/public/icon-512.png`. Real icons are a backlog item.

- [ ] **Step 9: Run and verify in Chrome MCP**

```bash
pnpm --filter @smart-contacts/pwa dev
```

Open `http://localhost:5174` in Chrome MCP with mobile viewport (use `mcp__claude-in-chrome__resize_window` to ~375×812). Expected: header with title and `0 контактов`, three bottom-nav items, switching tabs swaps body. DevTools → Application → Manifest shows the parsed manifest.

- [ ] **Step 10: Commit**

```bash
git add pwa/
git commit -m "feat(pwa): minimal mobile shell with bottom-nav and PWA manifest"
```

---

## Task 14: GitHub Actions CI

> **Carry-forward from P1.T2 code review (Important):** CI must run `pnpm install` with `HUSKY=0` so the `prepare` script (`husky`) does not attempt to install git hooks in the runner. Without this, a future change to the runner image or the `actions/checkout` settings could fail the install step opaquely.
>
> **Carry-forward from P1.T2 code review (non-blocking, Husky v10 deprecation):** The committed `.husky/pre-commit` uses Husky-9-style scaffolding (shebang + `_/husky.sh` source) that will fail under Husky v10. Before any future bump of `husky` past `9.x`, the hook body must be simplified to a single line `pnpm lint-staged` (no shebang, no source). Track this here so it is not lost; the actual rewrite happens at the time of the upgrade.

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      HUSKY: '0'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint + typecheck + test + build on push and PR"
```

---

## Task 15: GOOGLE_SETUP.md placeholder + plan handoff to P2

> **Carry-forward from P1.T1 code review:** The committed spec and plan documents contain absolute container-local paths (e.g. `/workspace/TaskOrchestrator-main/`, `/workspace/CLAUDE.md`). These will not resolve on any other machine. Before this repo is shared externally (cloned elsewhere or pushed to a remote), normalize those references to either repo-relative paths or descriptive prose that does not encode container internals. This is a documentation-hygiene chore; it has no functional impact on builds or tests.

**Files:**
- Create: `GOOGLE_SETUP.md`, `docs/superpowers/plans/README.md`
- Modify: `docs/superpowers/specs/2026-04-29-contacts-app-design.md`, `docs/superpowers/plans/2026-04-29-p1-foundation.md` (per carry-forward above)

- [ ] **Step 1: `GOOGLE_SETUP.md`** (placeholder with a single sentence and a TODO marker for plan P4/P5)

```markdown
# Google Setup

OAuth client configuration and required scopes will be documented here when Plan P4 (Device Sync) introduces Google Drive `appdata`, and updated again when Plan P5 (Google Contacts integration) introduces the `contacts` scope.
```

- [ ] **Step 2: `docs/superpowers/plans/README.md`** (table of contents with status)

```markdown
# Plans

| ID  | Plan                              | Status      |
| --- | --------------------------------- | ----------- |
| P1  | Foundation                        | this file   |
| P2  | CRUD + Desktop UI core            | not started |
| P3  | QuickEntry + lookup + filters     | not started |
| P4  | Device sync (drive.appdata)       | not started |
| P5  | Google Contacts integration       | not started |
| P6  | PWA mobile feature parity         | not started |
```

- [ ] **Step 3: Commit**

```bash
git add GOOGLE_SETUP.md docs/superpowers/plans/README.md
git commit -m "docs: GOOGLE_SETUP placeholder and plans index"
```

---

## Definition of Done for P1

- [ ] `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green at repo root.
- [ ] `pnpm dev:web` opens a browser shell with header, sidebar, empty main, and a status bar that shows "0 контактов" / "0 contacts" depending on locale.
- [ ] `pnpm dev:pwa` opens a mobile-viewport shell with header, bottom-nav (3 tabs), tab-switching works, and `vite-plugin-pwa` registers a service worker (verify in DevTools → Application).
- [ ] On both surfaces, a wa-sqlite database is initialized, migrations run, a `device_id` is generated and persists across reload (verified by inspecting IndexedDB → `smart-contacts-snapshots` and re-reading `meta.device_id`).
- [ ] CI workflow passes on a fresh checkout.
- [ ] All 15 tasks committed; commit history reads as a coherent foundation.

---

## Self-Review (run before handoff)

1. **Spec coverage:** §2 (architecture) — covered by Tasks 1-3, 12, 13. §3 (schema DDL) — Tasks 5, 7. §4-6 (sync, Google, avatars) — explicitly out of P1, deferred to P4/P5. §7 (Markdown) — out of P1. §8 (UI shell only) — Tasks 12, 13. §9 (Settings General/About only) — out of P1, will be added in P2. §10 (testing infra) — Tasks 3, 14. §11 (deploy scaffolding) — Task 14 (CI), full deploy in P6 release.
   **Gap accepted:** Settings dialog itself is a P2 deliverable; P1 only has the toggles wired into the StatusBar.
2. **Placeholder scan:** `GOOGLE_SETUP.md` is intentionally a placeholder, marked as such; its purpose is to reserve the file path. No "TBD" / "TODO: implement later" inside actual code tasks.
3. **Type consistency:** `Contact.lamportTs`, `Contact.deviceId`, `CustomFieldDef.lamportTs` — same casing across `types.ts` (camelCase TS) ↔ DB columns (snake_case SQL). Migrations use snake_case; `SyncPackage.contacts` items use the camelCase TS shape — this matches TaskOrchestrator's pattern (`taskToRow` / `rowToTask` will be added in P4 sync port). `DbAdapter` shape used identically in Tasks 6, 7, 8, 9, 12, 13. No drift.
