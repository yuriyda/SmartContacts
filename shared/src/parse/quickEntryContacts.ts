// QuickEntry parser for Smart Contacts.
// Converts shorthand tokens (prefix-based) into structured chip payloads.
//
// Supported prefixes: # tag, ! priority, / group, + phone, @ email,
//   * organization, & position (job title), ^ birthday, ~ nickname,
//   >> relation, ? channel, tg/gh/lk social.
//
// Rules:
//   - All chip patterns operate on single whitespace-separated words.
//   - Multi-word relation (>>Anna Petrova) is intentionally NOT supported in
//     tryCommitToken — multi-word relations must be entered via dialog.
//   - Birthday requires full year (DD.MM.YYYY or YYYY-MM-DD). Bare ^DD.MM returns null.
//   - Do not add UI logic or DB access to this module — pure parsing only.

import type { Contact } from '../types'

// ─── Public types ───────────────────────────────────────────────────────────

export type ChipType =
  | 'tag'
  | 'priority'
  | 'group'
  | 'phone'
  | 'email'
  | 'organization'
  | 'position'
  | 'birthday'
  | 'nickname'
  | 'relation'
  | 'channel'
  | 'social'

export type ChipPayload =
  | { kind: 'tag'; name: string }
  | { kind: 'priority'; value: 1 | 2 | 3 | 4 | 5 }
  | { kind: 'group'; name: string }
  | { kind: 'phone'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'organization'; name: string }
  | { kind: 'position'; value: string }
  | { kind: 'birthday'; date: string } // YYYY-MM-DD
  | { kind: 'nickname'; value: string }
  | { kind: 'relation'; query: string }
  | { kind: 'channel'; value: 'phone' | 'email' | 'telegram' | 'signal' | 'whatsapp' | 'other' }
  | { kind: 'social'; platform: 'tg' | 'gh' | 'lk'; handle: string }

export interface Chip {
  type: ChipType
  raw: string
  payload: ChipPayload
}

export interface ParsedQuickEntry {
  chips: Chip[]
  displayName: string
}

export interface QuickEntryContext {
  tags: string[]
  groups: Array<{ id: string; name: string }>
  contacts: Pick<Contact, 'id' | 'displayName'>[]
}

// ─── Regex constants ─────────────────────────────────────────────────────────

const RE_TAG = /^#(\S+)$/
const RE_PRIORITY = /^!([1-5])$/
const RE_GROUP = /^\/(\S+)$/
// Phone: + followed by 6+ digits/spaces/dashes/parens
const RE_PHONE = /^\+([\d\s\-(]{6,})$/
const RE_EMAIL = /^@(\S+@\S+\.\S+)$/
const RE_ORG = /^\*(\S+)$/
// Position / job title: &name (single whitespace-separated word)
const RE_POSITION = /^&(\S+)$/
// Birthday DD.MM.YYYY (with year)
const RE_BDAY_DMY = /^\^(\d{2})\.(\d{2})\.(\d{4})$/
// Birthday YYYY-MM-DD (with year)
const RE_BDAY_ISO = /^\^(\d{4}-\d{2}-\d{2})$/
const RE_NICK = /^~(\S+)$/
const RE_RELATION = /^>>(\S.*)$/
const RE_CHANNEL = /^\?(phone|email|telegram|signal|whatsapp|other)$/
const RE_SOCIAL = /^(tg|gh|lk):(\S+)$/

// ─── Core parser ─────────────────────────────────────────────────────────────

/**
 * Parse one whitespace-separated word; return chip + remaining if it commits, else null.
 * Input must be a single token with no leading/trailing whitespace.
 * `remaining` is always '' (single-word commit by design).
 */
export function tryCommitToken(text: string): { chip: Chip; remaining: string } | null {
  // Tag: #name
  const mTag = RE_TAG.exec(text)
  if (mTag) {
    const name = mTag[1] as string
    return { chip: { type: 'tag', raw: text, payload: { kind: 'tag', name } }, remaining: '' }
  }

  // Priority: !1..!5
  const mPriority = RE_PRIORITY.exec(text)
  if (mPriority) {
    const value = parseInt(mPriority[1] as string, 10) as 1 | 2 | 3 | 4 | 5
    return {
      chip: { type: 'priority', raw: text, payload: { kind: 'priority', value } },
      remaining: '',
    }
  }

  // Group: /name
  const mGroup = RE_GROUP.exec(text)
  if (mGroup) {
    const name = mGroup[1] as string
    return { chip: { type: 'group', raw: text, payload: { kind: 'group', name } }, remaining: '' }
  }

  // Phone: +digits (strip leading + from payload value)
  const mPhone = RE_PHONE.exec(text)
  if (mPhone) {
    const value = mPhone[1] as string
    return { chip: { type: 'phone', raw: text, payload: { kind: 'phone', value } }, remaining: '' }
  }

  // Email: @user@domain.tld
  const mEmail = RE_EMAIL.exec(text)
  if (mEmail) {
    const value = mEmail[1] as string
    return { chip: { type: 'email', raw: text, payload: { kind: 'email', value } }, remaining: '' }
  }

  // Organization: *name
  const mOrg = RE_ORG.exec(text)
  if (mOrg) {
    const name = mOrg[1] as string
    return {
      chip: { type: 'organization', raw: text, payload: { kind: 'organization', name } },
      remaining: '',
    }
  }

  // Position: &name → Contact.occupation
  const mPosition = RE_POSITION.exec(text)
  if (mPosition) {
    const value = mPosition[1] as string
    return {
      chip: { type: 'position', raw: text, payload: { kind: 'position', value } },
      remaining: '',
    }
  }

  // Birthday DD.MM.YYYY → convert to ISO YYYY-MM-DD
  const mBdayDMY = RE_BDAY_DMY.exec(text)
  if (mBdayDMY) {
    const dd = mBdayDMY[1] as string
    const mm = mBdayDMY[2] as string
    const yyyy = mBdayDMY[3] as string
    const date = `${yyyy}-${mm}-${dd}`
    return {
      chip: { type: 'birthday', raw: text, payload: { kind: 'birthday', date } },
      remaining: '',
    }
  }

  // Birthday YYYY-MM-DD → pass through
  const mBdayISO = RE_BDAY_ISO.exec(text)
  if (mBdayISO) {
    const date = mBdayISO[1] as string
    return {
      chip: { type: 'birthday', raw: text, payload: { kind: 'birthday', date } },
      remaining: '',
    }
  }

  // Bare ^DD.MM (no year) — intentionally NOT committed; falls through to null.
  // (RE_BDAY_DMY requires all three parts, so it won't match here.)

  // Nickname: ~name
  const mNick = RE_NICK.exec(text)
  if (mNick) {
    const value = mNick[1] as string
    return {
      chip: { type: 'nickname', raw: text, payload: { kind: 'nickname', value } },
      remaining: '',
    }
  }

  // Relation: >>query (single word only — multi-word via dialog)
  const mRelation = RE_RELATION.exec(text)
  if (mRelation) {
    const query = mRelation[1] as string
    return {
      chip: { type: 'relation', raw: text, payload: { kind: 'relation', query } },
      remaining: '',
    }
  }

  // Channel: ?phone|email|telegram|signal|whatsapp|other
  const mChannel = RE_CHANNEL.exec(text)
  if (mChannel) {
    const value = mChannel[1] as 'phone' | 'email' | 'telegram' | 'signal' | 'whatsapp' | 'other'
    return {
      chip: { type: 'channel', raw: text, payload: { kind: 'channel', value } },
      remaining: '',
    }
  }

  // Social: tg:handle | gh:handle | lk:handle
  const mSocial = RE_SOCIAL.exec(text)
  if (mSocial) {
    const platform = mSocial[1] as 'tg' | 'gh' | 'lk'
    const handle = mSocial[2] as string
    return {
      chip: { type: 'social', raw: text, payload: { kind: 'social', platform, handle } },
      remaining: '',
    }
  }

  return null
}

/**
 * Parse a full input string into chips + displayName remainder.
 * Words that match a prefix pattern become chips; remaining words form the displayName.
 */
export function parseQuickEntry(input: string): ParsedQuickEntry {
  const words = input.split(/\s+/).filter(Boolean)
  const chips: Chip[] = []
  const nameParts: string[] = []

  for (const word of words) {
    const result = tryCommitToken(word)
    if (result !== null) {
      chips.push(result.chip)
    } else {
      nameParts.push(word)
    }
  }

  return {
    chips,
    displayName: nameParts.join(' '),
  }
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

/**
 * Return autocomplete suggestions for the token the user is currently typing.
 * Returns an empty array when partial is empty or has no recognised prefix.
 *
 * Ordering for # and /:
 *   1. startsWith match (case-insensitive), alphabetical within group
 *   2. includes match (but not startsWith), alphabetical within group
 * Top 8 returned.
 *
 * For >>: case-insensitive includes match over displayNames; top 8.
 */
export function getSuggestions(
  partial: string,
  ctx: QuickEntryContext,
): Array<{ display: string; replace: string; type: ChipType }> {
  if (!partial) return []

  // Tag suggestions: #prefix
  if (partial.startsWith('#')) {
    const q = partial.slice(1).toLowerCase()
    return buildSuggestions(ctx.tags, q, (name) => ({
      display: name,
      replace: `#${name}`,
      type: 'tag' as ChipType,
    }))
  }

  // Group suggestions: /prefix
  if (partial.startsWith('/')) {
    const q = partial.slice(1).toLowerCase()
    const names = ctx.groups.map((g) => g.name)
    return buildSuggestions(names, q, (name) => ({
      display: name,
      replace: `/${name}`,
      type: 'group' as ChipType,
    }))
  }

  // Relation suggestions: >>prefix (fuzzy includes only)
  if (partial.startsWith('>>')) {
    const q = partial.slice(2).toLowerCase()
    const names = ctx.contacts.map((c) => c.displayName ?? '').filter((n) => n.length > 0)
    const matched = names.filter((n) => n.toLowerCase().includes(q)).slice(0, 8)
    return matched.map((name) => ({
      display: name,
      replace: `>>${name}`,
      type: 'relation' as ChipType,
    }))
  }

  return []
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build ranked suggestion list from a string array.
 * Ranks: startsWith first (insertion order), then includes (insertion order).
 * Maximum 8 results.
 */
function buildSuggestions<T>(
  candidates: string[],
  query: string,
  mapper: (name: string) => T,
): T[] {
  const q = query.toLowerCase()
  const startsWith: string[] = []
  const includes: string[] = []

  for (const c of candidates) {
    const cl = c.toLowerCase()
    if (cl.startsWith(q)) {
      startsWith.push(c)
    } else if (cl.includes(q)) {
      includes.push(c)
    }
  }

  return [...startsWith, ...includes].slice(0, 8).map(mapper)
}
