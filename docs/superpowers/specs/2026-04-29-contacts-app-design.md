# Contacts App — Design Spec

- **Date:** 2026-04-29
- **Status:** Draft, pending user review
- **Author:** brainstorming session
- **Reference project:** TaskOrchestrator — `https://github.com/yuriyda/TaskOrchestrator` (a working local mirror is also expected at the project's dev-container `TaskOrchestrator-main/` sibling for read-only inspection during plan execution)

> Editing rules for this file (per the project `CLAUDE.md`):
> - Always use `Edit`, never `Write` for revisions; never overwrite the whole file.
> - Ask before deleting any section.

---

## 1. Goal & Scope

A decentralized, offline-first contact manager with a feature set analogous to TaskOrchestrator, but for contacts instead of tasks. First phase ships as a pure-browser application (web SPA + PWA) so all CJMs can be exercised before introducing native packaging. Tauri is **explicitly out of scope** for this spec; the architecture is laid out to make Tauri the third workspace later, with no rewriting of `shared/`.

### MVP feature set (chosen during brainstorming)

- Local CRUD over a full Google-Contacts-equivalent data model (15 standard categories) **plus 10 named extensions** (see §3).
- State-based decentralized sync between user's own devices, transported via Google Drive `appdata` (Lamport timestamps + per-device vector clock + tombstones — direct port from TaskOrchestrator).
- **Bidirectional** integration with Google Contacts via the People API.
- **Mandatory** avatar download from Google Contacts with on-device cache.
- **Markdown / Obsidian export & import format frozen now**, implementation deferred (in backlog).
- Mobile PWA in scope from day one (separate bundle).
- Themes, Settings, Status Line, density modes, i18n EN/RU — visually and structurally identical to TaskOrchestrator.

### Non-goals (MVP)

- Native desktop packaging (Tauri).
- Server backend of any kind.
- Real-time peer-to-peer sync (decentralization here means "no server", not "WebRTC mesh").
- Encrypted local storage (refresh-token in `localStorage` is an acknowledged compromise; deferred until Tauri keychain).

---

## 2. High-Level Architecture

Repository layout mirrors TaskOrchestrator:

```
Contacts/
├── shared/                        # framework-agnostic core
│   ├── core/                      # contactActions, lookup, dates, recurrence-equivalent
│   ├── sync/                      # state-based Lamport sync (port of tauri-app/src/store/sync.ts)
│   ├── google/                    # OAuth (GIS), peopleApi, contactsSync, driveAppdata, avatarPipeline
│   ├── markdown/                  # serialize/parse front-matter A (in backlog)
│   ├── parse/                     # quickEntryContacts, dateInput, etc.
│   ├── i18n/                      # EN/RU
│   ├── themes/                    # default + gruvbox × dark/light (port of core/themes.ts)
│   ├── db/                        # db-like adapter + migrations (SQL DDL)
│   └── types.ts
├── web/                           # desktop SPA (sidebar + main + detail panel + Status Line)
├── pwa/                           # mobile-first SPA (single-pane, bottom-nav, swipe)
├── scripts/, img/, package.json, README.md, README.ru.md, GOOGLE_SETUP.md
```

When the Tauri phase begins, `tauri-app/` is added as a fourth workspace and reuses `shared/` unchanged.

**Stack:** TypeScript 5 (strict), React 18, Tailwind, lucide-react, Vite, Vitest, Playwright, `vite-plugin-pwa`. No backend. OAuth via Google Identity Services (GIS, client-side, PKCE).

**Storage layer.** Single `db-like` adapter exposing `select(sql, params)`, `execute(sql, params)`, `transaction(fn)` — same shape as `db: any` parameter in TaskOrchestrator's `sync.ts`. Two implementations:

- `web/` and `pwa/`: **wa-sqlite** running in-browser, persisted as a blob snapshot in IndexedDB. Same schema and SQL queries as the Tauri target. Marketed-as "IndexedDB-backed" — physically all data is in IndexedDB; conceptually it is one logical SQLite file.
- `tauri-app/` (later): `@tauri-apps/plugin-sql` over a real SQLite file on the filesystem.

`shared/sync/` and `shared/core/` write SQL only — they do not branch on backend.

---

## 3. Data Model

### Conventions

- IDs: ULIDs (26 chars), generated via `shared/ulid.ts` (port from TaskOrchestrator).
- All multi-valued Google fields are stored as **JSON columns** on the `contacts` row (not as separate child tables). This keeps each contact under a single `(lamport_ts, device_id)` pair, exactly mirroring how `tasks.tags` and `tasks.personas` are stored in TaskOrchestrator.
- All dates: ISO-8601 strings in TEXT columns. SQLite has no native DATE; CLAUDE.md's "date fields must be of date type" rule is honored at the application layer (parse/format), as SQLite cannot enforce it physically.
- Lookup tables (`tags_index`, `groups_index`) are **derived per device** and **not transported by sync** — same rule as `lists/tags/flows/personas` in TaskOrchestrator.

### Tables (DDL)

```sql
-- key/value: device_id, schema_version, settings overrides
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

-- vector clock for state-based sync
CREATE TABLE vector_clock (device_id TEXT PRIMARY KEY, counter INTEGER NOT NULL);

CREATE TABLE contacts (
  id                  TEXT PRIMARY KEY,                     -- ULID
  -- Google standard 1: names
  given_name          TEXT, family_name TEXT, middle_name TEXT,
  honorific_prefix    TEXT, honorific_suffix TEXT,
  phonetic_given      TEXT, phonetic_family TEXT,
  display_name        TEXT,
  -- 2: nickname
  nickname            TEXT,
  -- 3-11: multi-valued (JSON)
  phones              TEXT, -- [{value,type,primary?}]
  emails              TEXT, -- [{value,type,primary?}]
  addresses           TEXT, -- [{street,city,region,postal,country,type,primary?}]
  events              TEXT, -- [{date,type}]  birthday | anniversary | custom
  organizations       TEXT, -- [{name,title,department,startDate,endDate,current}]   ext#8 history
  urls                TEXT, -- [{value,type}]
  im_clients          TEXT, -- [{protocol,handle}]
  relations_external  TEXT, -- Google free-text relations: [{person,type}]
  groups              TEXT, -- [{id,name}]   Google membership
  -- 12-15
  notes_md            TEXT,                                  -- biographies + ext#7 Markdown
  user_defined        TEXT,                                  -- Google userDefined passthrough
  locale              TEXT, gender TEXT, occupation TEXT,
  -- Extensions
  tags                TEXT, -- string[]                       ext#1
  relations_internal  TEXT, -- [{contactId,type}]             ext#2 (FK to contacts.id, app-level)
  custom_fields       TEXT, -- {[defId]: value}               ext#3
  last_contacted_at   TEXT, -- ISO                            ext#4
  preferred_channel   TEXT, -- enum: phone|email|telegram|... ext#5
  priority            INTEGER, -- 1..5                        ext#6
  social_detected     TEXT, -- [{platform,handle}]            ext#9 derived
  reminders           TEXT, -- [{id,date,text,done?}]         ext#10
  -- Google integration state
  google_resource_name TEXT, google_etag TEXT, google_last_synced_at TEXT,
  -- Avatar pointer (blob lives in `avatars` table)
  avatar_hash         TEXT,
  -- Sync metadata (state-based Lamport)
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,                                   -- tombstone
  lamport_ts          INTEGER NOT NULL,
  device_id           TEXT NOT NULL
);
CREATE INDEX contacts_did_lts ON contacts(device_id, lamport_ts);
CREATE INDEX contacts_display ON contacts(display_name);
CREATE INDEX contacts_google  ON contacts(google_resource_name);

-- Custom field definitions (versioned and synced as part of SyncPackage)
CREATE TABLE custom_field_defs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text','date','number','url','boolean','select')),
  options TEXT,                                              -- JSON, for select
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  lamport_ts INTEGER NOT NULL, device_id TEXT NOT NULL
);

-- Avatars: blob keyed by contact, transported via drive.appdata bundle
CREATE TABLE avatars (
  contact_id TEXT PRIMARY KEY,
  blob       BLOB NOT NULL, mime TEXT NOT NULL,
  source_url TEXT, fetched_at TEXT NOT NULL, hash TEXT NOT NULL
);

-- Lookup indices, derived per device, NOT in sync
CREATE TABLE tags_index   (name TEXT PRIMARY KEY);
CREATE TABLE groups_index (id TEXT PRIMARY KEY, name TEXT);

-- Local-only UI activity feed
CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT, entity_id TEXT, action TEXT,
  device_id TEXT, lamport_ts INTEGER, data TEXT,
  created_at TEXT NOT NULL
);
```

### Notes on extensions

- `relations_internal` is bidirectional. The mirroring (when A→B writes "colleague", B→A receives "colleague") is implemented in `contactActions`, not in the database.
- `social_detected` is stored, not recomputed at view time, to keep sync deterministic across devices.
- `reminders` is a JSON array on the contact so the contact stays under a single Lamport stamp.
- `last_contacted_at` is set **manually** for MVP — a "Touch" button in the Detail Panel header writes the current ISO timestamp. No automatic detection on outgoing call/email/telegram clicks (that requires platform integration outside the browser). Backlog item if needed.
- Avatar blobs are synced via the bundle; not Lamport-versioned, bound to the contact via `avatar_hash`.

---

## 4. Sync Engine (Lamport, state-based)

**Direct port of `tauri-app/src/store/sync.ts`** to `shared/sync/`, with entities replaced from `tasks/notes/flow_meta` to `contacts/customFieldDefs/avatars`. Algorithm unchanged.

### Mechanics (identical to reference)

- On first run, the device generates `device_id = ULID` and stores it in `meta.device_id`.
- Any local write bumps `vector_clock[localDeviceId].counter` and stamps the row with `(lamport_ts = counter, device_id = localDeviceId)`.
- `buildSyncRequest(db) → { deviceId, vectorClock }`.
- `computeSyncPackage(db, targetVC)` returns rows where `lamport_ts > targetVC[device_id]`. Empty `targetVC` ⇒ full export (recovery).
- `importSyncPackage(db, pkg)` resolves conflicts via `shouldReplace(incomingLts, localLts, incomingDid, localDid)` — strictly higher `lamport_ts` wins; on tie, lexicographically greater `device_id` wins.
- After import, `localCounter = max(localCounter, maxImportedLts)`. Without this, post-sync local edits would lose to imported entries.
- Tombstones: `deleted_at` is preserved; soft-deleted rows participate in sync so deletions propagate.
- Lookup tables (`tags_index`, `groups_index`) are NOT in sync; after `importSyncPackage`, they are GC'd by re-scanning active contacts (same `DELETE FROM tags WHERE name NOT IN ...` pattern).

### Additions over reference

Avatars piggyback on `SyncPackage`:

```ts
interface SyncPackage {
  type: 'sync_package';
  deviceId: string | null;
  vectorClock: VectorClock;
  contacts: Contact[];
  customFieldDefs: CustomFieldDef[];
  avatars?: { contactId: string; mime: string; hash: string; blobBase64: string }[];
}
```

Receiver compares `avatars[i].hash` with its own `avatars(contact_id).hash`; if different or missing, overwrites the blob. Avatars carry no Lamport stamp — they are a shadow of `contacts.avatar_hash`, whose source of truth is the contact row itself.

### Transport

`shared/google/driveAppdata.ts` — pull/push of one JSON file `contacts.bundle.json` in the user's `appdata` scope, mirroring `tauri-app/src/store/googleDrive.ts` of the reference. Schema version is embedded in the bundle for forward migration.

### Tests

Port `tauri-app/src/sync.test.js` and `sync-log.test.js` to `shared/sync/sync.test.ts`, adapted to `contacts / customFieldDefs / avatars`.

---

## 5. Google Contacts Integration (bidirectional, separate channel)

This is **independent of the device-sync channel** in §4. Implementation lives in `shared/google/peopleApi.ts` + `shared/google/contactsSync.ts`.

### OAuth (GIS, client-side, PKCE)

Scopes:

- `https://www.googleapis.com/auth/contacts` — read+write
- `https://www.googleapis.com/auth/drive.appdata` — for §4
- `openid email profile` — display "synced as `<email>`"

Token storage (PWA phase):

- `access_token`: in memory + `sessionStorage` (cleared on tab close).
- `refresh_token`: `localStorage`. **Acknowledged compromise**; no better option without Tauri/keychain. Documented in Settings → Privacy & Security.
- Each sync checks `expires_at` and refreshes if needed.

### Per-contact integration state

Already in schema: `google_resource_name` (e.g. `people/c1234567890`), `google_etag` (used in `If-Match`), `google_last_synced_at`.

### Field mapping (`shared/google/peopleMapping.ts`)

1-to-1 for: names, nicknames, phoneNumbers, emailAddresses, addresses, birthdays, events, organizations, urls, biographies, imClients, memberships (groups), photos, userDefined, locales, genders, occupations, relations.

Exception: `notes_md` (our Markdown) ⇄ `biographies[].value` (plain text). On push: write Markdown as-is (Google does not render it but does not corrupt it). On pull: store as-is into `notes_md`. Conflict resolution operates on the whole field, not on Markdown structure.

### Extensions in Google

App-only extension fields are pushed into Google `userDefined` under reserved keys prefixed `__contacts_app_`:

- `__contacts_app_tags` — JSON-encoded `string[]`
- `__contacts_app_relations` — JSON-encoded `[{contactId,type}]`
- `__contacts_app_priority` — `1..5`
- `__contacts_app_preferred_channel`, `__contacts_app_last_contacted_at`, `__contacts_app_custom_fields`, `__contacts_app_reminders`, `__contacts_app_social_detected`

These are visible in the Google Contacts UI as "Custom fields"; this is the price for honest round-trip. `clientData` (legacy, narrow) is **not** used.

### Sync algorithm (manual `Sync with Google` button for MVP)

1. **Pull**: `people.connections.list` with `syncToken` (incremental).
   - New `resourceName` ⇒ insert locally, bump Lamport.
   - Existing, `etag` unchanged ⇒ skip.
   - Existing, `etag` changed: if local `updated_at <= google_last_synced_at` ⇒ accept remote (overwrite). Otherwise ⇒ **conflict**, queue for manual merge.
2. **Push**: contacts where `updated_at > google_last_synced_at`.
   - No `googleResourceName` ⇒ `people.createContact`. Save `resourceName` + `etag`.
   - With `googleResourceName` ⇒ `people.updateContact` with `If-Match: etag`. On 412 (etag mismatch) ⇒ conflict, queue.
3. **Conflicts**: `MergeConflictDialog` shows local | remote columns and a "Choose record" button. MVP resolves at the whole-record level. Per-field merge is a backlog item.
4. **Deletions**:
   - Local tombstone with `googleResourceName` ⇒ `people.deleteContact`. Tombstone retained for `gc-tombstones-after = 30 days` (needed for §4).
   - Remote-deleted (gone in `connections.list` with `syncToken`) ⇒ local tombstone.

### Frequency

MVP: manual-only (button in Settings and in StatusBar). Auto-sync (interval, on-start) is a Settings toggle but disabled by default; implementation belongs to MVP+1.

---

## 6. Avatar Pipeline

`shared/google/avatarPipeline.ts`.

- **Identification:** `hash = sha256(photos[].url + photos[].metadata.updateTime)`. If `contacts.avatar_hash == hash`, the local blob is current.
- **Queue (`AvatarFetchQueue`):** singleton per device, concurrency 2, rate-limit 6 req / 10 s, priority levels `high` (currently open contact), `normal` (visible in list via `IntersectionObserver`), `low` (everything else).
- **Storage:** `avatars(contact_id, blob, mime, source_url, fetched_at, hash)`. Writing the blob does **not** bump `lamport_ts` of the contact (hash is derived).
- **Failure modes:** 401 ⇒ refresh token, retry. 403/404 ⇒ mark "no avatar", skip in this session.
- **Triggers:** post-Google-sync (low for everyone with mismatched/missing hash), on contact open (high), on viewport-enter (normal).
- **UI:** `useAvatar(contactId)` hook returns `{ url, loading }`. Internally creates `URL.createObjectURL(blob)` and revokes in cleanup. Fallback: initials on a hash-colored background.
- **Bundle size note:** 500 contacts ≈ 5–15 MB; 5000 ≈ 50–150 MB. If `drive.appdata` size becomes a concern, chunked or separate-bundle is a backlog item.

Tests: priorities, rate-limit, dedup, hash detection, offline display.

---

## 7. Markdown / Obsidian Format (frozen, implementation deferred)

One contact = one `.md` file. Filename: `<slug>.md`, where `slug = kebab(displayName)` with `-2`/`-3` suffixes for collisions. Slug is stored in front-matter so renames don't break references; the primary key is `id`.

Round-trip is the goal. Front-matter is the source of truth for structured data; the body holds Markdown notes.

```markdown
---
id: 01HXY...
slug: ivan-ivanov

# Google standard 1: Names
givenName: Иван
familyName: Иванов
middleName: Сергеевич
displayName: Иван Иванов
honorificPrefix:
honorificSuffix:
phoneticGiven:
phoneticFamily:

# 2: Nickname
nickname: Ваня

# 3-11: multi-valued
phones:
  - { value: "+7 999 123 45 67", type: mobile, primary: true }
emails:
  - { value: "ivan@example.com", type: home, primary: true }
addresses:
  - { street: "Тверская 1", city: "Москва", region: "", postal: "125009", country: "RU", type: home }
events:
  - { date: "1985-03-15", type: birthday }
organizations:
  - { name: "Acme", title: "CTO", department: "Eng", startDate: "2020-01-01", current: true }
urls:
  - { value: "https://ivan.dev", type: personal }
imClients:
  - { protocol: telegram, handle: "@ivan" }
relationsExternal:
  - { person: "Анна", type: spouse }
groups:
  - { id: "contactGroups/myContacts", name: "Мои контакты" }

# 12-15
userDefined:
  someKey: someValue
locale: ru
gender: male
occupation: Engineer

# Extensions
tags: [друзья, dev]
relationsInternal:
  - "[[anna-ivanova]]"
  - { contact: "[[petr-petrov]]", type: colleague }
customFields:
  preferredCoffee: эспрессо
lastContactedAt: 2026-04-20T14:30:00Z
preferredChannel: telegram
priority: 2
socialDetected:
  - { platform: telegram, handle: "@ivan" }
reminders:
  - { id: 01HXZ..., date: "2026-05-01", text: "поздравить с ДР", done: false }

# Service
google:
  resourceName: people/c1234567890
  etag: "abc..."
  lastSyncedAt: 2026-04-29T10:00:00Z
sync:
  lamportTs: 142
  deviceId: 01HW...
  createdAt: 2026-01-01T00:00:00Z
  updatedAt: 2026-04-29T10:00:00Z
---

# Иван Иванов

Markdown notes (`notes_md`).

## Встречи
- 2026-04-20 — обсудили проект X
```

### Rules

- `deleted_at` set ⇒ file is not written (or removed during folder sync).
- Avatars: separate `_attachments/<id>.<ext>`, optional pointer in front-matter.
- Import recognizes `id` from front-matter as the primary key. Missing `id` ⇒ generate new ULID (file authored manually in Obsidian).
- `notes_md` ⇄ body, no transformation.
- Local-vs-Markdown conflict: compare `sync.updatedAt` of file with `contacts.updated_at`; on divergence — manual merge dialog.

Implementation is in backlog (after browser-phase MVP stabilizes).

---

## 8. UI

Visual language, color themes, density modes, Status Line and Settings dialog are reused from TaskOrchestrator 1-to-1: same `core/themes.ts` (default + gruvbox × dark/light), same StatusBar shape, same SettingsDialog tab layout.

### Desktop (`web/`)

```
┌─────────────────────────────────────────────────────────────────┐
│  [☰]  Contacts                          [🔍 search]  [+ Add]    │
├──────────┬──────────────────────────────────┬──────────────────┤
│ Sidebar  │  Main list / Cards grid          │  Detail panel    │
│  All     │  ContactRow ContactRow           │  Avatar  Name    │
│  ★ Star  │  ContactRow ContactRow           │  Phones / Email  │
│  Groups  │  ContactRow ContactRow           │  Addresses       │
│  Tags    │  ...                             │  Org / Notes     │
│  Custom  │                                  │  Custom fields   │
│  Recent  │                                  │  Tags            │
│  Trash   │                                  │  Relations →     │
│          │                                  │  Reminders       │
├──────────┴──────────────────────────────────┴──────────────────┤
│  StatusBar: 142 contacts · synced 2 min ago · device A · ▣ ▣  │
└─────────────────────────────────────────────────────────────────┘
```

- **Sidebar**: All / Starred (priority ≥ 4) / Birthdays-this-month / Groups (Google) / Tags / Saved filters / Recent activity / Trash.
- **Main**: list (dense) ↔ cards toggle. Sortbar by name / lastContactedAt / createdAt / priority. Bulk actions via checkboxes + context menu.
- **Detail Panel**: collapsible sections — Names, Contacts, Addresses, Events, Organization, URLs, IM, Notes (Markdown editor), Tags, Custom fields, Relations (clickable), Reminders, History (auto-built from `sync_log`). Inline edit for simple fields, modal `ContactEditDialog` for multi-valued.
- **StatusBar**: contacts count under filter; sync indicator; Google integration state; device-id (4-char prefix); theme/density toggles.
- **Keyboard**: `j/k` navigate, `e` edit, `d` soft-delete, `t` tag, `/` focus search, `?` help, `Esc` close panel, `Cmd/Ctrl+N` QuickEntry, `Cmd/Ctrl+,` Settings.

### Mobile (`pwa/`)

Single-pane SPA mirroring `pwa/src/MobileApp.tsx`:

- Bottom nav: All / Starred / Settings.
- Tap row → full-screen `ContactDetail`.
- Swipe-right ⇒ star, swipe-left ⇒ soft-delete with undo-toast.
- Editing in full-screen modal, sectioned.
- Status indicator inline as a chip in the header.
- iOS PWA: manifest + service worker (offline-first cache via `vite-plugin-pwa`).

### QuickEntry (token-chip parser)

Structurally identical to `tauri-app/src/ui/QuickEntry.tsx` and `parse/quickEntry.js`; parser lives in `shared/parse/quickEntryContacts.ts`.

| Prefix | Chip type | Semantics |
|---|---|---|
| `#` | tag | append to `tags` (ext#1) |
| `!` | priority | `priority` 1..5 (ext#6) |
| `/` | group | Google group membership |
| `+` | phone | parsed into `phones[]` (auto-detect mobile/work) |
| `@` | email | parsed into `emails[]` |
| `*` | organization | `organizations[]` (current=true) |
| `^` | birthday | `events[]` type=birthday, parsed date |
| `~` | nickname | `nickname` |
| `>>` | relation | autocomplete by displayName ⇒ `relations_internal` |
| `?` | preferred channel | enum (ext#5) |
| `tg:` `gh:` `lk:` | social handle | `socialDetected[]` (ext#9) |

Example:
```
Иван Иванов #dev #важные !2 /Work +79991234567 @ivan@acme.com *Acme ^15.03.1985 >>Анна
```

Suggestions dropdown navigated with Arrow / Tab / Enter, same UX as reference. Tab on `displayName` opens full `ContactEditDialog` for fields without a prefix (addresses, phonetics, custom fields).

Placement: top bar (always visible) on desktop, behind `+` in header on mobile. Tests in `parse/quickEntryContacts.test.ts` per prefix.

---

## 9. Settings

`SettingsDialog.tsx` ports `tauri-app/src/ui/SettingsDialog.tsx`.

| Tab | Contents |
|---|---|
| **General** | Language EN/RU; theme default/gruvbox × dark/light; density compact/comfortable; date format DD.MM.YYYY / YYYY-MM-DD / MM/DD/YYYY; mobile start screen All/Starred. |
| **Google Sync** | Sign in / out; Sync now + last status; Sync on app start (toggle); Auto-sync every N min (5..60); Reset sync state (clears `google_resource_name`/`etag`/`last_synced_at` for all contacts). |
| **Device Sync** | Same Google account (extended scope shares one token); known devices from `vector_clock` with last-seen + outgoing changes count; Force full export / Force full import; Sync now. |
| **Avatars** | Prefetch toggle; concurrency 1/2/4; rate-limit slider; max cache size MB (default 200); Clear avatar cache. |
| **Custom fields** | CRUD over `custom_field_defs` (name, type, options for select). |
| **Backup / Restore** | Export full DB → `contacts-backup-<ISO>.json` (all tables + avatars inline; **distinct from** `contacts.bundle.json` in `drive.appdata`); Import (merge or replace); Reset all data (double-confirm). |
| **Markdown** | Disabled placeholder ("Coming soon") for MVP. Target folder picker added later. |
| **Privacy & Security** | Documentation of token storage; Sign out from all Google services (revoke + clear tokens). |
| **Onboarding** | Replay welcome guide (re-show `GuideOverlay`). |
| **About** | Version, full `device_id` (copyable), build hash, GitHub repo link, license. |

Persistence: `meta` table (`key/value`), included in `SyncPackage` as a `settings` dict, merged with last-write-wins per Lamport. Per-device-only settings are not split out for MVP; if needed, a separate scope is added later.

---

## 9.1. Demo Data Generator

**Owner:** Plan **P2** (CRUD + Desktop UI core). Cannot land before P2 because the UI to view/edit a contact does not exist in P1, so visual verification is impossible.

**Reference:** TaskOrchestrator's `tauri-app/src/core/demo.ts` (`buildDemoTasks(locale)` → curated 50 tasks, `loadDemoData` button in onboarding/settings).

### Module

`shared/src/core/demo.ts`. Exports:

```ts
export function buildDemoContacts(locale: 'en' | 'ru'): {
  contacts: Contact[]            // exactly 50 entries
  groups: GroupMembership[]      // labels referenced by contacts
  customFieldDefs: CustomFieldDef[]
}
```

### Authoring rules (strict, follow TaskOrchestrator pattern)

- **Curated, not procedural.** 50 contacts written by hand per locale, each with realistic, internally consistent data. No `faker`, no random names. Two parallel arrays — `en` and `ru` — that mirror each other in structure but use locale-appropriate names, addresses, organizations, and notes.
- **Stable IDs within a single call** via an `_idMap[n]: ULID` factory (matches TO's pattern). `relationsInternal: [{ contactId: id(7), type: 'colleague' }]` resolves the same ULID as the contact authored at slot `n=7`. `id()` itself uses a 26-char Crockford-base32 random string.
- **Dates relative to today** via `rel(offsetDays)` returning ISO date — birthdays anchored to fixed years, `lastContactedAt` and reminder dates relative.
- **No avatar blobs.** Demo data leaves `avatarHash: null`; the avatar cell falls back to initials-on-hash-color (the existing pipeline §6 fallback). Avoiding embedded base64 keeps the demo bundle small.
- **Lamport metadata seeded.** Each demo contact ships with `lamportTs` set to a sequential counter starting at 1 (per local device) and `deviceId` = current device ID. Demo contacts are real DB rows after load, not a separate display-mode.

### Field-density target (per locale, 50 contacts)

Reasonable mix that exercises every standard category and every extension at least a few times each, but does not bloat every record:

| Field group | ~count out of 50 |
|---|---|
| `phones` (≥1 phone) | 45 |
| `emails` (≥1 email) | 40 |
| `addresses` | 18 |
| `events` (birthday/anniversary) | 30 |
| `organizations` (current + past) | 25 (of which ~8 with non-current history entry) |
| `urls` | 15 |
| `imClients` | 10 |
| `relationsExternal` (Google free-text) | 6 |
| `groups` (Google labels) | 50 (each in ≥1 group) |
| `notesMd` (Markdown content) | 25 |
| `userDefined` | 4 |
| `locale`, `gender`, `occupation` | sparse (5-10 each) |
| `tags` | 50 (each ≥1 tag) |
| `relationsInternal` (FK pairs) | 20 (10 mutual pairs) |
| `customFields` | 12 |
| `lastContactedAt` set | 35 |
| `preferredChannel` | 30 |
| `priority` set | 50 (full distribution 1..5) |
| `socialDetected` | 15 |
| `reminders` | 10 |
| `googleResourceName` | 0 (demo data is local-only; Google sync is opt-in) |

Seven groups defined: `Family`, `Work`, `Friends`, `Clients`, `School`, `Health`, `Doctors`. RU equivalents: `Семья`, `Работа`, `Друзья`, `Клиенты`, `Учёба`, `Спорт`, `Врачи`.

Three demo `CustomFieldDef`s defined: `preferredCoffee` (text), `bonusCardNumber` (text), `metAt` (date).

### Trigger UI

In the Settings → General tab and in the first-run onboarding overlay:

- Button label: `Load demo data` / `Загрузить демо-данные`.
- Confirm dialog: warns that 50 contacts will be inserted into the local store, names the locale, offers `Cancel` / `Confirm`.
- After confirm: `loadDemoData(buildDemoContacts(locale))` runs in a single `db.transaction` wrapping all 50 inserts plus `customFieldDefs` plus `groups_index` rows.
- Idempotency: if the DB already has rows where `meta.demo_seeded === '<locale>'`, the button is disabled with tooltip `Demo data already loaded; clear contacts first`.
- After successful load, `meta.demo_seeded` is set to the locale; subsequent `Reset all data` clears it along with everything else.

### Tests (Vitest, in P2)

- Round-trip: `buildDemoContacts('en')` returns 50 contacts; all `relationsInternal.contactId` values resolve to other contacts in the same array (no dangling refs).
- Locale parity: `en` and `ru` arrays have identical length and matching field-count distributions (within ±2 per category) — guards against drift when one locale gets edited and the other doesn't.
- Insert-and-query: applying demo data into a fresh wa-sqlite DB and `SELECT COUNT(*) FROM contacts` returns 50, distinct `device_id`s = 1, all `tags_index` rows derived correctly.
- Idempotency: second load attempt (without reset) is a no-op or rejected; `meta.demo_seeded` flag visible.

### Why this can't land in P1

- No CRUD adapters in `shared/core/contactActions` (P2).
- No Settings dialog (P2).
- No onboarding overlay (P2).
- No Detail Panel to view a loaded contact (P2).
- Manual visual verification through Chrome MCP is unavailable (no contact UI to render the row).

P1 ships with the schema and storage; demo data is the first user-visible feature in P2 and is the natural seed for all subsequent CJMs (search, edit, sort, filter, sync, conflict resolution).

---

## 10. Testing & Quality

### Pyramid

- **Unit (Vitest):** sync (port + extensions), syncLog, quickEntryContacts (per prefix), peopleMapping (lossless round-trip including `__contacts_app_*`), avatarPipeline (priorities, rate-limit, dedup), markdown serialize/parse (when implemented).
- **Integration (Vitest + jsdom + fake-indexeddb):** full chain `ContactEditDialog → contactActions.upsert → DB → useContacts → React state` (per CLAUDE.md, the full chain, not only DB write); two-device sync convergence including deletions and tombstones; Google sync via `msw` mocks (push / pull / 412 conflict / create / delete); `useMemo`/`useCallback` dependency tests (per CLAUDE.md, especially around `lastContactedAt` and any `new Date()` derived values).
- **E2E (Playwright + Chrome MCP):** Playwright owns automated E2E; Chrome MCP (`mcp__claude-in-chrome__*`) is used for **interactive CJM verification during development**, including taking GIFs of multi-step flows. Per CLAUDE.md, all E2E acceptance scenarios are **repeatable** — every flow is exercised twice in a row to catch residual-state bugs:
  - **CJM-1 ×2:** create → find → soft-delete → create with same displayName → find → delete.
  - **Google sync ×2:** sync → no-op → sync again. No false conflicts, no redundant network calls.
  - **Avatar prefetch ×2:** sync → verify blobs → clear cache → sync again → verify re-fetch.
  - **Two-device convergence ×2:** sync from device A, mutate on B, sync, verify; mutate on A, sync, verify.
  - **Conflict merge ×2:** induce a conflict, resolve via `MergeConflictDialog`, repeat with same record.

### Tooling

- TypeScript strict; ESLint with `eslint-plugin-react-hooks` enforced (deps must include all reactive values, especially around `useMemo` per CLAUDE.md); Prettier; Vitest; Playwright; `vite-plugin-pwa`; `husky` + `lint-staged`.
- CI: GitHub Actions — lint + types + unit + integration on push/PR; E2E on release branch.

### Manual QA checklist (per UI-touching PR, per CLAUDE.md)

1. Add a contact via QuickEntry with 5 prefixes — verify DB row and UI render.
2. Sync 100 contacts with avatars from Google — verify prefetch order and visibility.
3. Induce a conflict — verify `MergeConflictDialog` and post-merge state.
4. Open in incognito (separate `device_id`) — pull `drive.appdata` — verify convergence.
5. Resize to mobile breakpoints — verify swipe-actions and bottom-nav.
6. Replay welcome guide after switching to dark theme — no style regressions.

---

## 11. Deployment & Migrations

### Deployment (browser phase)

- One repo, two independent Vite projects.
- Hosting: any static (Cloudflare Pages, Vercel, Netlify, GitHub Pages); no backend.
- Domains: `contacts.<domain>` ⇒ `web/dist`, `m.contacts.<domain>` ⇒ `pwa/dist` (or single domain with UA detection).
- OAuth `redirect_uri`: same origin via GIS popup mode (no server callback needed).
- `drive.appdata` file: one per user, named `contacts.bundle.json`. Schema version embedded.

### Migrations

`shared/db/migrations.ts` ports `tauri-app/src/store/migrations.ts`. Schema version in `meta.schema_version`. All DDL is idempotent and runs on startup. On major-version bumps, an automatic export of `.bundle.json` is taken before applying migrations.

---

## 12. Effort Estimate (rough)

- `shared/`: ~3 500–5 000 lines of TS (sync, google, peopleMapping, parse, db, markdown, themes, i18n).
- `web/`: ~4 000–6 000 lines (UI, ~25 form sections).
- `pwa/`: ~2 000–3 000 lines.
- Total: 10–14 KLOC TS, comparable to TaskOrchestrator (~12 KLOC).

---

## 12.1. P-Plan Sequence (authoritative)

The MVP is decomposed into six sequential plans; each ships independently and each is an end-to-end-testable slice.

| ID | Plan | Notes |
|---|---|---|
| P1 | Foundation | monorepo, schema, wa-sqlite, themes, i18n, shells |
| P2 | CRUD + Desktop UI core | contactActions, forms, sidebar/main/detail, Settings dialog, **demo data generator (§9.1)** |
| P3 | QuickEntry + lookup + filters | shorthand parser, saved filters |
| P4 | Device sync (drive.appdata, Lamport) | port of TO `sync.ts` |
| P5 | Google Contacts integration | People API, conflicts, avatar pipeline |
| P6 | PWA mobile feature parity | swipe, bottom-nav editing, offline behaviour |

Markdown export/import (§7) becomes P7 if/when prioritised; not part of MVP.

---

## 13. Open Questions / Backlog

- Markdown export/import — implementation (format frozen here).
- Auto-sync intervals (Google + drive.appdata) — UI exists, default off, behavior MVP+1.
- Per-field merge for Google conflicts (MVP is whole-record).
- Encrypted local storage for `refresh_token` (deferred to Tauri keychain).
- Chunked or separate avatar bundle for very large datasets (> ~50 MB).
- Auto-detection of social platforms in `social_detected` (heuristics list to be extended over time).
- Reminders surfacing: standalone notifications panel vs. embedding into Detail Panel only — current spec keeps them in Detail Panel only for MVP.
