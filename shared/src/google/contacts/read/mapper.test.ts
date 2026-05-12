// Tests for mapper.ts — People API Person → NormalizedContact.
// Run with: pnpm --filter @smart-contacts/shared test
// Each fixture covers a distinct scenario; see comments before each describe block.

import { describe, it, expect } from 'vitest'
import { personToNormalized } from './mapper.js'
import type { Person } from './types.js'

// ---------------------------------------------------------------------------
// Fixture A — minimal: only displayName present
// ---------------------------------------------------------------------------
describe('fixture A: minimal person (displayName only)', () => {
  const person: Person = {
    resourceName: 'people/c123',
    etag: 'etag-a',
    names: [{ displayName: 'Alice' }],
  }

  it('maps resourceName and etag', () => {
    const nc = personToNormalized(person)
    expect(nc.googleResourceName).toBe('people/c123')
    expect(nc.etag).toBe('etag-a')
  })

  it('maps displayName', () => {
    expect(personToNormalized(person).displayName).toBe('Alice')
  })

  it('leaves optional scalars undefined', () => {
    const nc = personToNormalized(person)
    expect(nc.givenName).toBeUndefined()
    expect(nc.familyName).toBeUndefined()
    expect(nc.nickname).toBeUndefined()
    expect(nc.notesMd).toBeUndefined()
    expect(nc.locale).toBeUndefined()
    expect(nc.gender).toBeUndefined()
    expect(nc.occupation).toBeUndefined()
    expect(nc.photoUrl).toBeNull()
    expect(nc.photoContentHash).toBeNull()
  })

  it('returns empty arrays for multi-valued fields', () => {
    const nc = personToNormalized(person)
    expect(nc.phones).toEqual([])
    expect(nc.emails).toEqual([])
    expect(nc.addresses).toEqual([])
    expect(nc.events).toEqual([])
    expect(nc.organizations).toEqual([])
    expect(nc.urls).toEqual([])
    expect(nc.imClients).toEqual([])
    expect(nc.labelResourceNames).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Fixture B — all scalar fields populated
// ---------------------------------------------------------------------------
describe('fixture B: all scalar fields populated', () => {
  const person: Person = {
    resourceName: 'people/c456',
    etag: 'etag-b',
    metadata: {
      sources: [{ updateTime: '2026-05-01T10:00:00Z' }],
    },
    names: [
      {
        displayName: 'Dr. Bob Smith Jr.',
        givenName: 'Bob',
        familyName: 'Smith',
        middleName: 'Alan',
        honorificPrefix: 'Dr.',
        honorificSuffix: 'Jr.',
        phoneticGivenName: 'BAB',
        phoneticFamilyName: 'SMYTH',
      },
    ],
    nicknames: [{ value: 'Bobby' }],
    biographies: [{ value: 'A note about Bob.', contentType: 'TEXT_PLAIN' }],
    locales: [{ value: 'en-US' }],
    genders: [{ value: 'male', formattedValue: 'Male' }],
    occupations: [{ value: 'Engineer' }],
  }

  it('maps all name sub-fields', () => {
    const nc = personToNormalized(person)
    expect(nc.displayName).toBe('Dr. Bob Smith Jr.')
    expect(nc.givenName).toBe('Bob')
    expect(nc.familyName).toBe('Smith')
    expect(nc.middleName).toBe('Alan')
    expect(nc.honorificPrefix).toBe('Dr.')
    expect(nc.honorificSuffix).toBe('Jr.')
    expect(nc.phoneticGiven).toBe('BAB')
    expect(nc.phoneticFamily).toBe('SMYTH')
  })

  it('maps nickname', () => {
    expect(personToNormalized(person).nickname).toBe('Bobby')
  })

  it('maps notesMd from biography', () => {
    expect(personToNormalized(person).notesMd).toBe('A note about Bob.')
  })

  it('maps locale, gender (formattedValue preferred), occupation', () => {
    const nc = personToNormalized(person)
    expect(nc.locale).toBe('en-US')
    expect(nc.gender).toBe('Male')
    expect(nc.occupation).toBe('Engineer')
  })

  it('maps updateTime from metadata.sources[0]', () => {
    expect(personToNormalized(person).updateTime).toBe('2026-05-01T10:00:00Z')
  })
})

// ---------------------------------------------------------------------------
// Fixture C — multiple phones with different types + phone normalization
// ---------------------------------------------------------------------------
describe('fixture C: multiple phones', () => {
  const person: Person = {
    resourceName: 'people/c789',
    etag: 'etag-c',
    phoneNumbers: [
      { value: '+1 (555) 123-4567', type: 'mobile', formattedType: 'Mobile' },
      { value: '800.555.0100', type: 'work', formattedType: 'Work' },
      { value: '555 9999', type: 'home', formattedType: 'Home' },
    ],
  }

  it('maps correct number of phones', () => {
    expect(personToNormalized(person).phones).toHaveLength(3)
  })

  it('normalizes international phone: strips spaces, dashes, parentheses', () => {
    const nc = personToNormalized(person)
    const [first] = nc.phones
    expect(first?.value).toBe('+15551234567')
  })

  it('normalizes non-plus phone: strips dots', () => {
    const [, second] = personToNormalized(person).phones
    expect(second?.value).toBe('8005550100')
  })

  it('maps type and label', () => {
    const nc = personToNormalized(person)
    const [first] = nc.phones
    expect(first?.type).toBe('mobile')
    expect(first?.label).toBe('Mobile')
  })
})

// ---------------------------------------------------------------------------
// Fixture D — multiple emails + email normalization
// ---------------------------------------------------------------------------
describe('fixture D: multiple emails', () => {
  const person: Person = {
    resourceName: 'people/c101',
    etag: 'etag-d',
    emailAddresses: [
      { value: 'John.Doe@Gmail.Com', type: 'home', formattedType: 'Home' },
      { value: '  Alice@WORK.com  ', type: 'work', formattedType: 'Work' },
    ],
  }

  it('maps correct number of emails', () => {
    expect(personToNormalized(person).emails).toHaveLength(2)
  })

  it('lowercases and trims email', () => {
    const nc = personToNormalized(person)
    const [first, second] = nc.emails
    expect(first?.value).toBe('john.doe@gmail.com')
    expect(second?.value).toBe('alice@work.com')
  })

  it('maps email type and label', () => {
    const [first] = personToNormalized(person).emails
    expect(first?.type).toBe('home')
    expect(first?.label).toBe('Home')
  })
})

// ---------------------------------------------------------------------------
// Fixture E — multiple addresses + organizations
// ---------------------------------------------------------------------------
describe('fixture E: addresses and organizations', () => {
  const person: Person = {
    resourceName: 'people/c202',
    etag: 'etag-e',
    addresses: [
      {
        streetAddress: '123 Main St',
        city: 'Springfield',
        region: 'IL',
        postalCode: '62701',
        country: 'United States',
        type: 'home',
      },
      {
        streetAddress: '1 Infinite Loop',
        city: 'Cupertino',
        region: 'CA',
        postalCode: '95014',
        country: 'US',
        type: 'work',
      },
    ],
    organizations: [
      {
        name: 'Acme Corp',
        title: 'VP Engineering',
        department: 'R&D',
        current: true,
        startDate: { year: 2020, month: 3, day: 1 },
      },
      {
        name: 'Old Corp',
        title: 'Developer',
        current: false,
        startDate: { year: 2015, month: 1, day: 15 },
        endDate: { year: 2020, month: 2, day: 28 },
      },
    ],
  }

  it('maps both addresses', () => {
    const nc = personToNormalized(person)
    const [first] = nc.addresses
    expect(nc.addresses).toHaveLength(2)
    expect(first).toEqual({
      street: '123 Main St',
      city: 'Springfield',
      region: 'IL',
      postal: '62701',
      country: 'United States',
      type: 'home',
    })
  })

  it('maps both organizations', () => {
    const nc = personToNormalized(person)
    const [firstOrg] = nc.organizations
    expect(nc.organizations).toHaveLength(2)
    expect(firstOrg?.name).toBe('Acme Corp')
    expect(firstOrg?.title).toBe('VP Engineering')
    expect(firstOrg?.department).toBe('R&D')
    expect(firstOrg?.current).toBe(true)
    expect(firstOrg?.startDate).toBe('2020-03-01')
  })

  it('maps org endDate', () => {
    const [, secondOrg] = personToNormalized(person).organizations
    expect(secondOrg?.endDate).toBe('2020-02-28')
  })
})

// ---------------------------------------------------------------------------
// Fixture F — photos (default marker), userDefined, memberships, IM, URLs, events
// ---------------------------------------------------------------------------
describe('fixture F: photos, userDefined, memberships, imClients, urls, events', () => {
  const person: Person = {
    resourceName: 'people/c303',
    etag: 'etag-f',
    photos: [
      { url: 'https://lh3.google.com/photo/preferred', default: true },
      { url: 'https://lh3.google.com/photo/other', default: false },
    ],
    userDefined: [
      { key: 'loyalty_id', value: 'ABC123' },
      { key: 'vip', value: 'true' },
    ],
    memberships: [
      {
        contactGroupMembership: {
          contactGroupResourceName: 'contactGroups/friends',
        },
      },
      {
        contactGroupMembership: {
          contactGroupResourceName: 'contactGroups/starred',
        },
      },
      // Domain membership should be ignored
      { domainMembership: { inViewerDomain: true } },
    ],
    imClients: [
      { protocol: 'telegram', username: '@carol', formattedProtocol: 'Telegram', type: 'other' },
    ],
    urls: [{ value: 'HTTPS://EXAMPLE.COM/Profile', type: 'profile' }],
    events: [
      { date: { year: 1990, month: 7, day: 15 }, type: 'birthday' },
      { date: { month: 6, day: 1 }, type: 'anniversary' },
    ],
  }

  it('picks the default photo', () => {
    expect(personToNormalized(person).photoUrl).toBe('https://lh3.google.com/photo/preferred')
  })

  it('photoContentHash is always null from mapper', () => {
    expect(personToNormalized(person).photoContentHash).toBeNull()
  })

  it('maps userDefined as record', () => {
    expect(personToNormalized(person).userDefined).toEqual({
      loyalty_id: 'ABC123',
      vip: 'true',
    })
  })

  it('maps contactGroup memberships, ignores domainMembership', () => {
    const nc = personToNormalized(person)
    expect(nc.labelResourceNames).toEqual(['contactGroups/friends', 'contactGroups/starred'])
  })

  it('maps imClients', () => {
    const nc = personToNormalized(person)
    const [firstIm] = nc.imClients
    expect(nc.imClients).toHaveLength(1)
    expect(firstIm).toEqual({ protocol: 'telegram', handle: '@carol' })
  })

  it('lowercases URLs', () => {
    const [firstUrl] = personToNormalized(person).urls
    expect(firstUrl?.value).toBe('https://example.com/profile')
  })

  it('maps events with date reconstruction', () => {
    const nc = personToNormalized(person)
    const [firstEvent, secondEvent] = nc.events
    expect(nc.events).toHaveLength(2)
    expect(firstEvent).toEqual({ type: 'birthday', date: '1990-07-15' })
    // Year absent → 0
    expect(secondEvent).toEqual({ type: 'anniversary', date: '0-06-01' })
  })
})

// ---------------------------------------------------------------------------
// Photo default-marker edge cases
// ---------------------------------------------------------------------------
describe('photo default-marker edge cases', () => {
  it('picks [0] when photos[0].default=true and photos[1].default=false', () => {
    const person: Person = {
      resourceName: 'people/cx',
      etag: '',
      photos: [
        { url: 'https://photo.example/first', default: true },
        { url: 'https://photo.example/second', default: false },
      ],
    }
    expect(personToNormalized(person).photoUrl).toBe('https://photo.example/first')
  })

  it('falls back to [0] when neither photo is marked default', () => {
    const person: Person = {
      resourceName: 'people/cy',
      etag: '',
      photos: [{ url: 'https://photo.example/a' }, { url: 'https://photo.example/b' }],
    }
    expect(personToNormalized(person).photoUrl).toBe('https://photo.example/a')
  })

  it('returns null when photos array is absent', () => {
    const person: Person = { resourceName: 'people/cz', etag: '' }
    expect(personToNormalized(person).photoUrl).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// gender fallback: uses formattedValue over value when both present
// ---------------------------------------------------------------------------
describe('gender field', () => {
  it('prefers formattedValue when present', () => {
    const person: Person = {
      resourceName: 'people/cg',
      etag: '',
      genders: [{ value: 'male', formattedValue: 'Male' }],
    }
    expect(personToNormalized(person).gender).toBe('Male')
  })

  it('falls back to value when formattedValue absent', () => {
    const person: Person = {
      resourceName: 'people/cg2',
      etag: '',
      genders: [{ value: 'female' }],
    }
    expect(personToNormalized(person).gender).toBe('female')
  })
})
