# Smart Contacts — Plan P3: QuickEntry + saved filters + lookup GC

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add a TaskOrchestrator-style QuickEntry parser (`#tag !priority /group +phone @email *org ^birthday ~nickname >>relation ?channel tg:/gh:/lk:`), saved filter presets in Settings, periodic GC of orphaned `tags_index`/`groups_index` rows, and notes-Markdown live preview in ContactDetail.

**Architecture:** Parser is pure, lives in `shared/src/parse/quickEntryContacts.ts`. UI sits in `web/src/ui/QuickEntry.tsx` (token chips + suggestions dropdown), wired into `NavHeader`. Saved filters serialise as JSON in `meta.saved_filters_v1`. GC is invoked after every contactsRepo write that touches tags or groups.

**Tech stack:** No new infrastructure.

**Reference (read-only):** `/workspace/TaskOrchestrator-main/tauri-app/src/parse/quickEntry.js`, `/workspace/TaskOrchestrator-main/tauri-app/src/ui/QuickEntry.tsx`.

**Spec:** Spec §8 (QuickEntry table of prefixes) + spec §3 ext fields. P3 implements: QuickEntry full set, saved filters, lookup GC, notes Markdown preview toggle in ContactDetail (full Markdown body) — keeping the inline renderer added in P2.T10 as a fallback if the toggle is off.

---

## Standing rules

1. Every task ends with `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green.
2. Header comment on every TS module; English-only commits; no Claude attribution.
3. Browser smoke test (Chrome MCP) is required for any task that touches UI.

---

## Task 1: QuickEntry parser

**Files:**
- Create: `shared/src/parse/quickEntryContacts.ts`, `shared/src/parse/quickEntryContacts.test.ts`
- Modify: `shared/src/index.ts`

**Exports:**

```ts
export type ChipType =
  | 'tag' | 'priority' | 'group' | 'phone' | 'email'
  | 'organization' | 'birthday' | 'nickname'
  | 'relation' | 'channel' | 'social'

export interface Chip {
  type: ChipType
  raw: string                  // exactly as entered (e.g. '#dev', '!2', '+79991234567')
  payload: ChipPayload         // structured value
}

export type ChipPayload =
  | { kind: 'tag'; name: string }
  | { kind: 'priority'; value: 1 | 2 | 3 | 4 | 5 }
  | { kind: 'group'; name: string }
  | { kind: 'phone'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'organization'; name: string }
  | { kind: 'birthday'; date: string }    // YYYY-MM-DD
  | { kind: 'nickname'; value: string }
  | { kind: 'relation'; query: string }   // resolved later via context
  | { kind: 'channel'; value: 'phone' | 'email' | 'telegram' | 'signal' | 'whatsapp' | 'other' }
  | { kind: 'social'; platform: 'tg' | 'gh' | 'lk'; handle: string }

export interface ParsedQuickEntry {
  chips: Chip[]
  displayName: string         // remaining text after stripping all tokens; trimmed
}

export function tryCommitToken(text: string): { chip: Chip; remaining: string } | null
export function parseQuickEntry(input: string): ParsedQuickEntry
export function getSuggestions(
  partial: string,
  ctx: { tags: string[]; groups: { id: string; name: string }[]; contacts: Contact[] },
): Array<{ display: string; replace: string; type: ChipType }>
```

Patterns (case-sensitive prefixes; whitespace-separated):

| Prefix    | Regex             | Notes                                               |
| --------- | ----------------- | --------------------------------------------------- |
| `#name`   | `/^#(\S+)$/`      | tag                                                 |
| `!N`      | `/^!([1-5])$/`    | priority 1..5                                       |
| `/name`   | `/^\/(\S+)$/`     | group name (case-insensitive lookup)                |
| `+digits` | `/^\+([\d\s\-()]{6,})$/` | phone, retain `+` and digits/spaces           |
| `@local@domain` | `/^@(\S+@\S+\.\S+)$/` | email                                       |
| `*name`   | `/^\*(\S+)$/`     | organization                                        |
| `^date`   | accepts `^DD.MM.YYYY`, `^YYYY-MM-DD` | birthday                              |
| `~nick`   | `/^~(\S+)$/`      | nickname                                            |
| `>>name`  | `/^>>(.+)$/`      | relation query                                      |
| `?word`   | `/^\?(phone\|email\|telegram\|signal\|whatsapp\|other)$/` | channel  |
| `tg:@h`   | `/^(tg|gh|lk):(\S+)$/` | social handle                                  |

`tryCommitToken(text)` examines a single space-separated word and returns the chip if it parses, else `null`. Used by the input field to commit tokens incrementally as the user types space.

`parseQuickEntry(input)` walks every word, accumulates chips for matched ones, and joins the rest into `displayName`.

`getSuggestions(partial, ctx)`:
- If `partial` starts with `#` and there's a `tags` list, return tags that start with the prefix (max 8, case-insensitive).
- If `/`, suggest groups.
- If `>>`, fuzzy-match contacts by `displayName`.
- Otherwise empty.

Tests cover every prefix + edge cases (invalid priority, malformed email, ambiguous `^15.03` no year — should NOT commit).

## Task 2: QuickEntry UI

**Files:**
- Create: `web/src/ui/QuickEntry.tsx`
- Modify: `web/src/ui/NavHeader.tsx` (add QuickEntry behind the `+ Add` button as an inline expansion)
- Modify: `web/src/SmartContactsApp.tsx` (wire `onQuickAdd` that converts a `ParsedQuickEntry` into a Contact and calls `upsert`)

`onQuickAdd` builder:
```ts
const onQuickAdd = useCallback(async (parsed: ParsedQuickEntry) => {
  const newContact: Contact = {
    id: ulid(),
    displayName: parsed.displayName,
    createdAt: '', updatedAt: '', lamportTs: 0, deviceId: deviceId ?? '',
  }
  for (const c of parsed.chips) {
    switch (c.payload.kind) {
      case 'tag':   newContact.tags = [...(newContact.tags ?? []), c.payload.name]; break
      case 'priority': newContact.priority = c.payload.value; break
      case 'group': newContact.groups = [...(newContact.groups ?? []), { id: 'g_' + slugify(c.payload.name), name: c.payload.name }]; break
      case 'phone': newContact.phones = [...(newContact.phones ?? []), { value: c.payload.value, type: 'mobile', primary: true }]; break
      case 'email': newContact.emails = [...(newContact.emails ?? []), { value: c.payload.value, type: 'work', primary: true }]; break
      case 'organization': newContact.organizations = [{ name: c.payload.name, current: true }]; break
      case 'birthday': newContact.events = [{ date: c.payload.date, type: 'birthday' }]; break
      case 'nickname': newContact.nickname = c.payload.value; break
      case 'channel': newContact.preferredChannel = c.payload.value; break
      case 'social': newContact.socialDetected = [...(newContact.socialDetected ?? []), { platform: c.payload.platform, handle: c.payload.handle }]; break
      case 'relation': {
        const partner = contacts.find((x) => (x.displayName ?? '').toLowerCase().includes(c.payload.query.toLowerCase()))
        if (partner) newContact.relationsInternal = [...(newContact.relationsInternal ?? []), { contactId: partner.id }]
        break
      }
    }
  }
  await upsert(newContact)
  // Mirror rule for relations is handled by SmartContactsApp's existing handleSaveContact path.
}, [contacts, deviceId, upsert])
```

UI: input grows to fit chips; `Tab` after typing displayName opens full `ContactEditDialog`; `Enter` commits new contact; `Esc` closes.

## Task 3: Saved filter presets

**Files:**
- Modify: `web/src/ui/Sidebar.tsx` — section "Saved" with stored filter presets, each with `×` to delete.
- Modify: `web/src/ui/StatusBar.tsx` — when a non-trivial filter is active, show a "Save filter" button.
- Create: `web/src/ui/savedFilters.ts` — `loadSavedFilters(meta)`, `saveSavedFilters(saveMeta, list)`.

Storage: JSON-encoded array in `meta.saved_filters_v1`. Each preset is `{ id, name, filters: ContactFilters }`.

## Task 4: Lookup GC

**Files:**
- Create: `shared/src/db/lookupGc.ts`, tests
- Modify: `shared/src/db/contactsRepo.ts` — call `runLookupGc(tx)` at the end of every write that touches tags/groups (upsert, restore, softDelete).

```sql
DELETE FROM tags_index   WHERE name NOT IN (SELECT DISTINCT value FROM contacts, json_each(contacts.tags) WHERE contacts.deleted_at IS NULL)
DELETE FROM groups_index WHERE id   NOT IN (SELECT DISTINCT json_extract(value, '$.id') FROM contacts, json_each(contacts.groups) WHERE contacts.deleted_at IS NULL)
```

(Inline SQL inside `db.transaction`.)

## Task 5: Notes Markdown live preview toggle

**Files:**
- Modify: `web/src/ui/ContactDetail.tsx` — add a small "raw / preview" toggle on the Notes section, default preview.
- Move the inline Markdown renderer from `ContactDetail.tsx` into `web/src/ui/markdownInline.tsx` so it can be imported by both the read view and a future edit-time preview pane.

## Task 6: Browser smoke test

Run dev, manually exercise:
- QuickEntry: type `Иван Иванов #dev !2 /Work +79991234567 @ivan@acme.com *Acme ^15.03.1985` → see chips + Enter creates contact + appears in list with all fields.
- Saved filter: filter to `priority<=2 AND group=Work`, click Save filter, name it; appears in Sidebar; click → reapplies.
- Delete a contact; verify `tags_index` after lookupGc shows no orphans (query DB).

Record outcome at the bottom of the plan as `## Manual CJM verification — passed YYYY-MM-DD`.
