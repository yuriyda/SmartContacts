// Tests for QuickEntry parser — quickEntryContacts.ts
// Covers all 11 prefix patterns (valid + invalid), parseQuickEntry integration,
// and getSuggestions with context.
// Do not add UI or DB dependencies here — pure unit tests only.

import { describe, test, expect } from 'vitest'
import { tryCommitToken, parseQuickEntry, getSuggestions } from './quickEntryContacts'

// ─── tryCommitToken ───────────────────────────────────────────────────────────

describe('tryCommitToken', () => {
  test('hashtag type', () => {
    expect(tryCommitToken('#dev')?.chip.type).toBe('tag')
  })

  test('hashtag payload name', () => {
    expect((tryCommitToken('#dev')?.chip.payload as { kind: string; name: string }).name).toBe(
      'dev',
    )
  })

  test('priority valid', () => {
    expect((tryCommitToken('!2')?.chip.payload as never as { value: number }).value).toBe(2)
  })

  test('priority all valid values', () => {
    for (const n of [1, 2, 3, 4, 5] as const) {
      expect((tryCommitToken(`!${n}`)?.chip.payload as never as { value: number }).value).toBe(n)
    }
  })

  test('priority invalid — !9', () => {
    expect(tryCommitToken('!9')).toBeNull()
  })

  test('priority invalid — !0', () => {
    expect(tryCommitToken('!0')).toBeNull()
  })

  test('priority invalid — !6', () => {
    expect(tryCommitToken('!6')).toBeNull()
  })

  test('group type', () => {
    expect(tryCommitToken('/Work')?.chip.type).toBe('group')
  })

  test('group payload name', () => {
    expect((tryCommitToken('/Work')?.chip.payload as never as { name: string }).name).toBe('Work')
  })

  test('phone type', () => {
    expect(tryCommitToken('+79991234567')?.chip.type).toBe('phone')
  })

  test('phone payload value strips leading +', () => {
    expect((tryCommitToken('+79991234567')?.chip.payload as never as { value: string }).value).toBe(
      '79991234567',
    )
  })

  test('phone too short — rejected', () => {
    expect(tryCommitToken('+1234')).toBeNull()
  })

  test('phone with dashes', () => {
    expect(tryCommitToken('+7-999-123-45-67')?.chip.type).toBe('phone')
  })

  test('email type', () => {
    expect(tryCommitToken('@a@b.co')?.chip.type).toBe('email')
  })

  test('email payload value', () => {
    expect((tryCommitToken('@a@b.co')?.chip.payload as never as { value: string }).value).toBe(
      'a@b.co',
    )
  })

  test('email malformed — rejected', () => {
    expect(tryCommitToken('@bad-email')).toBeNull()
  })

  test('email without @-in-address — rejected', () => {
    expect(tryCommitToken('@nodomain')).toBeNull()
  })

  test('organization type', () => {
    expect(tryCommitToken('*Acme')?.chip.type).toBe('organization')
  })

  test('organization payload name', () => {
    expect((tryCommitToken('*Acme')?.chip.payload as never as { name: string }).name).toBe('Acme')
  })

  test('position type', () => {
    expect(tryCommitToken('&CTO')?.chip.type).toBe('position')
  })

  test('position payload value', () => {
    expect((tryCommitToken('&CTO')?.chip.payload as never as { value: string }).value).toBe('CTO')
  })

  test('position rejects bare ampersand', () => {
    expect(tryCommitToken('&')).toBeNull()
  })

  test('position rejects ampersand with spaces (multi-word not supported)', () => {
    // tryCommitToken expects single token; a multi-word position is impossible here.
    expect(tryCommitToken('&Senior Engineer')).toBeNull()
  })

  test('birthday DD.MM.YYYY converts to ISO', () => {
    expect((tryCommitToken('^15.03.1985')?.chip.payload as never as { date: string }).date).toBe(
      '1985-03-15',
    )
  })

  test('birthday YYYY-MM-DD passes through', () => {
    expect((tryCommitToken('^1985-03-15')?.chip.payload as never as { date: string }).date).toBe(
      '1985-03-15',
    )
  })

  test('birthday type is birthday', () => {
    expect(tryCommitToken('^01.01.2000')?.chip.type).toBe('birthday')
  })

  test('birthday no year — rejected', () => {
    expect(tryCommitToken('^15.03')).toBeNull()
  })

  test('birthday bare ^ — rejected', () => {
    expect(tryCommitToken('^')).toBeNull()
  })

  test('nickname type', () => {
    expect(tryCommitToken('~Vanya')?.chip.type).toBe('nickname')
  })

  test('nickname payload value', () => {
    expect((tryCommitToken('~Vanya')?.chip.payload as never as { value: string }).value).toBe(
      'Vanya',
    )
  })

  test('relation type', () => {
    expect(tryCommitToken('>>Anna')?.chip.type).toBe('relation')
  })

  test('relation payload query', () => {
    expect((tryCommitToken('>>Anna')?.chip.payload as never as { query: string }).query).toBe(
      'Anna',
    )
  })

  test('relation >> alone — rejected', () => {
    expect(tryCommitToken('>>')).toBeNull()
  })

  test('channel telegram', () => {
    expect((tryCommitToken('?telegram')?.chip.payload as never as { value: string }).value).toBe(
      'telegram',
    )
  })

  test('channel phone', () => {
    expect((tryCommitToken('?phone')?.chip.payload as never as { value: string }).value).toBe(
      'phone',
    )
  })

  test('channel email', () => {
    expect((tryCommitToken('?email')?.chip.payload as never as { value: string }).value).toBe(
      'email',
    )
  })

  test('channel signal', () => {
    expect((tryCommitToken('?signal')?.chip.payload as never as { value: string }).value).toBe(
      'signal',
    )
  })

  test('channel whatsapp', () => {
    expect((tryCommitToken('?whatsapp')?.chip.payload as never as { value: string }).value).toBe(
      'whatsapp',
    )
  })

  test('channel other', () => {
    expect((tryCommitToken('?other')?.chip.payload as never as { value: string }).value).toBe(
      'other',
    )
  })

  test('channel invalid — rejected', () => {
    expect(tryCommitToken('?bogus')).toBeNull()
  })

  test('channel type is channel', () => {
    expect(tryCommitToken('?telegram')?.chip.type).toBe('channel')
  })

  test('social tg platform', () => {
    expect(
      (tryCommitToken('tg:@ivan')?.chip.payload as never as { platform: string; handle: string })
        .platform,
    ).toBe('tg')
  })

  test('social tg handle preserved', () => {
    expect((tryCommitToken('tg:@ivan')?.chip.payload as never as { handle: string }).handle).toBe(
      '@ivan',
    )
  })

  test('social gh handle', () => {
    expect(
      (tryCommitToken('gh:user-name')?.chip.payload as never as { handle: string }).handle,
    ).toBe('user-name')
  })

  test('social lk platform', () => {
    expect(
      (tryCommitToken('lk:profile')?.chip.payload as never as { platform: string }).platform,
    ).toBe('lk')
  })

  test('social type is social', () => {
    expect(tryCommitToken('tg:ivan')?.chip.type).toBe('social')
  })

  test('social bare tg: — rejected', () => {
    expect(tryCommitToken('tg:')).toBeNull()
  })

  test('plain word does not commit', () => {
    expect(tryCommitToken('Иван')).toBeNull()
  })

  test('plain latin word does not commit', () => {
    expect(tryCommitToken('Hello')).toBeNull()
  })

  test('remaining is always empty string on commit', () => {
    expect(tryCommitToken('#dev')?.remaining).toBe('')
  })

  test('raw equals input on commit', () => {
    expect(tryCommitToken('#dev')?.chip.raw).toBe('#dev')
  })
})

// ─── parseQuickEntry ──────────────────────────────────────────────────────────

describe('parseQuickEntry', () => {
  test('full example — chips', () => {
    const out = parseQuickEntry(
      'Иван Иванов #dev !2 /Work +79991234567 @ivan@a.co *Acme ^15.03.1985 >>Анна',
    )
    expect(out.chips.map((c) => c.type)).toEqual([
      'tag',
      'priority',
      'group',
      'phone',
      'email',
      'organization',
      'birthday',
      'relation',
    ])
  })

  test('full example — displayName', () => {
    const out = parseQuickEntry(
      'Иван Иванов #dev !2 /Work +79991234567 @ivan@a.co *Acme ^15.03.1985 >>Анна',
    )
    expect(out.displayName).toBe('Иван Иванов')
  })

  test('no chips — just name', () => {
    expect(parseQuickEntry('Just a Name').displayName).toBe('Just a Name')
  })

  test('no chips — chips array empty', () => {
    expect(parseQuickEntry('Just a Name').chips).toHaveLength(0)
  })

  test('all chips no name — displayName empty', () => {
    expect(parseQuickEntry('#a !1').displayName).toBe('')
  })

  test('extra spaces collapsed', () => {
    expect(parseQuickEntry('  Foo   Bar  ').displayName).toBe('Foo Bar')
  })

  test('empty string', () => {
    const out = parseQuickEntry('')
    expect(out.chips).toHaveLength(0)
    expect(out.displayName).toBe('')
  })

  test('only spaces', () => {
    const out = parseQuickEntry('   ')
    expect(out.chips).toHaveLength(0)
    expect(out.displayName).toBe('')
  })

  test('chip raw preserved in output', () => {
    const out = parseQuickEntry('#dev')
    expect(out.chips[0]?.raw).toBe('#dev')
  })

  test('birthday chip date correct in full parse', () => {
    const out = parseQuickEntry('^01.06.1990')
    expect((out.chips[0]?.payload as never as { date: string }).date).toBe('1990-06-01')
  })

  test('rejected bare birthday goes to displayName', () => {
    const out = parseQuickEntry('^15.03')
    expect(out.displayName).toBe('^15.03')
    expect(out.chips).toHaveLength(0)
  })
})

// ─── getSuggestions ───────────────────────────────────────────────────────────

describe('getSuggestions', () => {
  const ctx = {
    tags: ['dev', 'devops', 'design', 'friend'],
    groups: [
      { id: 'g_w', name: 'Work' },
      { id: 'g_h', name: 'Home' },
    ],
    contacts: [
      { id: '01', displayName: 'Anna Petrova' },
      { id: '02', displayName: 'Anton Belov' },
      { id: '03', displayName: 'Boris Smirnov' },
    ],
  }

  test('# tag prefix matches case-insensitively', () => {
    const sug = getSuggestions('#de', ctx)
    expect(sug.map((s) => s.display)).toEqual(['dev', 'devops', 'design'])
  })

  test('# suggestion replace format', () => {
    const sug = getSuggestions('#de', ctx)
    expect(sug[0]?.replace).toBe('#dev')
  })

  test('# suggestion type is tag', () => {
    const sug = getSuggestions('#de', ctx)
    expect(sug[0]?.type).toBe('tag')
  })

  test('# exact prefix still returns it', () => {
    const sug = getSuggestions('#dev', ctx)
    expect(sug.map((s) => s.display)).toContain('dev')
  })

  test('/ group prefix', () => {
    expect(getSuggestions('/wo', ctx).map((s) => s.display)).toEqual(['Work'])
  })

  test('/ group suggestion type is group', () => {
    expect(getSuggestions('/wo', ctx)[0]?.type).toBe('group')
  })

  test('/ case insensitive', () => {
    expect(getSuggestions('/WO', ctx).map((s) => s.display)).toEqual(['Work'])
  })

  test('>> relation prefix matches anywhere', () => {
    expect(getSuggestions('>>An', ctx).map((s) => s.display)).toEqual([
      'Anna Petrova',
      'Anton Belov',
    ])
  })

  test('>> relation suggestion type is relation', () => {
    expect(getSuggestions('>>An', ctx)[0]?.type).toBe('relation')
  })

  test('>> relation replace includes >>', () => {
    expect(getSuggestions('>>An', ctx)[0]?.replace).toBe('>>Anna Petrova')
  })

  test('>> no match returns empty', () => {
    expect(getSuggestions('>>Zzz', ctx)).toEqual([])
  })

  test('empty partial returns empty', () => {
    expect(getSuggestions('', ctx)).toEqual([])
  })

  test('unrecognised prefix returns empty', () => {
    expect(getSuggestions('hello', ctx)).toEqual([])
  })

  test('# no match returns empty', () => {
    expect(getSuggestions('#zzz', ctx)).toEqual([])
  })

  test('startsWith ranked before includes', () => {
    // 'dev', 'developer' start with 'dev'; 'event' only includes 'ev' but does not start with 'dev'
    const ctxExtra = { ...ctx, tags: ['event', 'dev', 'developer'] }
    const sug = getSuggestions('#dev', ctxExtra)
    const displays = sug.map((s) => s.display)
    // 'dev' and 'developer' must appear before 'event' (startsWith before includes)
    const idxDev = displays.indexOf('dev')
    const idxEvent = displays.indexOf('event')
    expect(idxDev).toBeGreaterThanOrEqual(0)
    if (idxEvent !== -1) {
      expect(idxDev).toBeLessThan(idxEvent)
    }
  })

  test('max 8 results for tags', () => {
    const manyTags = Array.from({ length: 20 }, (_, i) => `tag${i}`)
    const sug = getSuggestions('#tag', { ...ctx, tags: manyTags })
    expect(sug.length).toBeLessThanOrEqual(8)
  })

  test('max 8 results for relations', () => {
    const manyContacts = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      displayName: `Person ${i}`,
    }))
    const sug = getSuggestions('>>Person', { ...ctx, contacts: manyContacts })
    expect(sug.length).toBeLessThanOrEqual(8)
  })

  test('contacts with empty displayName excluded from >> suggestions', () => {
    const ctxEmpty = {
      ...ctx,
      contacts: [
        { id: '99', displayName: '' },
        { id: '01', displayName: 'Anna' },
      ],
    }
    const sug = getSuggestions('>>A', ctxEmpty)
    expect(sug.map((s) => s.display)).toEqual(['Anna'])
  })

  test('contacts with undefined displayName excluded from >> suggestions', () => {
    const ctxUndef = {
      ...ctx,
      contacts: [
        { id: '99' } as { id: string; displayName?: string },
        { id: '01', displayName: 'Anna' },
      ],
    }
    const sug = getSuggestions('>>A', ctxUndef)
    expect(sug.map((s) => s.display)).toEqual(['Anna'])
  })
})
