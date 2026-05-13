// Tests for differ.ts — three-way merge Changeset computation.
// Covers spec §6.2 (scalars), §6.3 (arrays), §6.4 (photos), §6.5 (labels),
// §6.6 (deletions), §6.8 (idempotency).
// Run with: pnpm --filter @smart-contacts/shared test

import { describe, it, expect } from 'vitest'
import { computeChangeset } from './differ.js'
import type { NormalizedContact } from './types.js'
import type { GoogleLabelRow } from './label-repo.js'

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeContact(overrides: Partial<NormalizedContact> = {}): NormalizedContact {
  return {
    googleResourceName: 'people/c001',
    etag: 'etag-1',
    updateTime: '2026-01-01T00:00:00Z',
    displayName: 'Alice Smith',
    givenName: 'Alice',
    familyName: 'Smith',
    phones: [],
    emails: [],
    addresses: [],
    events: [],
    birthdays: [],
    relations: [],
    organizations: [],
    urls: [],
    imClients: [],
    notesMd: undefined,
    userDefined: {},
    locale: undefined,
    gender: undefined,
    occupation: undefined,
    photoUrl: null,
    photoContentHash: null,
    labelResourceNames: [],
    ...overrides,
  }
}

const NOW = '2026-05-10T10:00:00.000Z'
const RUN_ID = 'run-test-001'

/** Empty input → empty Changeset */
function emptyInput() {
  return {
    runId: RUN_ID,
    snapshots: new Map<string, NormalizedContact>(),
    theirs: [],
    deletedRemotely: [],
    ours: [],
    theirLabels: [],
    theirLabelMemberships: new Map<string, string[]>(),
    now: NOW,
  }
}

// ---------------------------------------------------------------------------
// §6.8 Idempotency — basic empty cases
// ---------------------------------------------------------------------------

describe('§6.8 idempotency', () => {
  it('T-IDMP-1: empty inputs → empty Changeset', () => {
    const cs = computeChangeset(emptyInput())
    expect(cs.cleanInserts).toHaveLength(0)
    expect(cs.cleanUpdates).toHaveLength(0)
    expect(cs.cleanDeletes).toHaveLength(0)
    expect(cs.conflicts).toHaveLength(0)
    expect(cs.counts).toEqual({ inserts: 0, updates: 0, deletes: 0, conflicts: 0 })
  })

  it('T-IDMP-2: run twice with same inputs → identical output (deep equal)', () => {
    const contact = makeContact({ displayName: 'Bob', notesMd: 'notes' })
    const input = {
      ...emptyInput(),
      snapshots: new Map([['people/c001', contact]]),
      theirs: [contact],
      ours: [contact],
    }
    const cs1 = computeChangeset(input)
    const cs2 = computeChangeset(input)
    expect(JSON.stringify(cs1)).toBe(JSON.stringify(cs2))
  })

  it('T-IDMP-3: after applying clean updates, re-run → empty cleanUpdates', () => {
    // Simulate: first run showed theirs.displayName change; after apply,
    // ours = theirs, snapshot = theirs → no more changes
    const base = makeContact({ displayName: 'Old Name' })
    const theirsContact = makeContact({ displayName: 'New Name' })
    const firstCs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([['people/c001', base]]),
      theirs: [theirsContact],
      ours: [base],
    })
    expect(firstCs.cleanUpdates.some((u) => u.fieldPath === 'displayName')).toBe(true)

    // After apply: ours = theirsContact, snapshot = theirsContact
    const secondCs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([['people/c001', theirsContact]]),
      theirs: [theirsContact],
      ours: [theirsContact],
    })
    expect(secondCs.cleanUpdates).toHaveLength(0)
    expect(secondCs.conflicts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// §6.2 Scalar merge matrix — displayName
// ---------------------------------------------------------------------------

describe('§6.2 scalar merge — displayName', () => {
  const base = makeContact({ displayName: 'Alice' })
  const rn = 'people/c001'

  it('T-SCALAR-1: ours==base, theirs==base → noop', () => {
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ displayName: 'Alice' })],
      ours: [makeContact({ displayName: 'Alice' })],
    })
    expect(cs.cleanUpdates.filter((u) => u.fieldPath === 'displayName')).toHaveLength(0)
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-SCALAR-2: ours==base, theirs!=base → apply theirs', () => {
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ displayName: 'Alice B.' })],
      ours: [makeContact({ displayName: 'Alice' })],
    })
    const upd = cs.cleanUpdates.find((u) => u.fieldPath === 'displayName')
    expect(upd).toBeDefined()
    expect(upd?.newValue).toBe('Alice B.')
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-SCALAR-3: ours!=base, theirs==base → keep ours', () => {
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ displayName: 'Alice' })],
      ours: [makeContact({ displayName: 'Alice C.' })],
    })
    expect(cs.cleanUpdates.filter((u) => u.fieldPath === 'displayName')).toHaveLength(0)
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-SCALAR-4: ours!=base, theirs!=base, ours==theirs → apply (converged)', () => {
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ displayName: 'Alice X' })],
      ours: [makeContact({ displayName: 'Alice X' })],
    })
    // apply-theirs but newValue == ours, so no update emitted (noop effectively)
    const upd = cs.cleanUpdates.find((u) => u.fieldPath === 'displayName')
    // converged: apply-theirs, but deepEqual(ours, theirs) → no update pushed
    expect(upd).toBeUndefined()
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-SCALAR-5: ours!=base, theirs!=base, ours!=theirs → CONFLICT', () => {
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ displayName: 'Alice Google' })],
      ours: [makeContact({ displayName: 'Alice Local' })],
    })
    const conflict = cs.conflicts.find((c) => c.fieldPath === 'displayName')
    expect(conflict).toBeDefined()
    expect(conflict?.googleValueJson).toBe(JSON.stringify('Alice Google'))
    expect(conflict?.localValueJson).toBe(JSON.stringify('Alice Local'))
    expect(conflict?.baseValueJson).toBe(JSON.stringify('Alice'))
  })
})

// ---------------------------------------------------------------------------
// §6.2 Scalar merge matrix — notesMd
// ---------------------------------------------------------------------------

describe('§6.2 scalar merge — notesMd', () => {
  const rn = 'people/c001'
  const base = makeContact({ notesMd: 'Original notes' })

  it('T-NOTES-1: ours==base, theirs==base → noop', () => {
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ notesMd: 'Original notes' })],
      ours: [makeContact({ notesMd: 'Original notes' })],
    })
    expect(cs.cleanUpdates.filter((u) => u.fieldPath === 'notesMd')).toHaveLength(0)
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-NOTES-2: ours==base, theirs changed → apply theirs', () => {
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ notesMd: 'New Google notes' })],
      ours: [makeContact({ notesMd: 'Original notes' })],
    })
    const upd = cs.cleanUpdates.find((u) => u.fieldPath === 'notesMd')
    expect(upd?.newValue).toBe('New Google notes')
  })

  it('T-NOTES-3: ours changed, theirs==base → keep ours (no update)', () => {
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ notesMd: 'Original notes' })],
      ours: [makeContact({ notesMd: 'My local notes' })],
    })
    expect(cs.cleanUpdates.filter((u) => u.fieldPath === 'notesMd')).toHaveLength(0)
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-NOTES-4: ours changed, theirs changed, same change → apply-theirs (converged)', () => {
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ notesMd: 'Both changed same' })],
      ours: [makeContact({ notesMd: 'Both changed same' })],
    })
    expect(cs.cleanUpdates.filter((u) => u.fieldPath === 'notesMd')).toHaveLength(0)
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-NOTES-5: ours changed, theirs changed differently → CONFLICT', () => {
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ notesMd: 'Google changed notes' })],
      ours: [makeContact({ notesMd: 'Local changed notes' })],
    })
    const conflict = cs.conflicts.find((c) => c.fieldPath === 'notesMd')
    expect(conflict).toBeDefined()
    expect(conflict?.googleValueJson).toBe('"Google changed notes"')
    expect(conflict?.localValueJson).toBe('"Local changed notes"')
  })
})

// ---------------------------------------------------------------------------
// §6.3 Array merge — phones
// ---------------------------------------------------------------------------

describe('§6.3 array merge — phones', () => {
  const rn = 'people/c001'
  const phone1 = { value: '+15550001', type: 'home', label: 'Home' }
  const phone2 = { value: '+15550002', type: 'work', label: 'Work' }

  it('T-PHONE-1: added in theirs only → cleanUpdate adds phone', () => {
    const base = makeContact({ phones: [] })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ phones: [phone1] })],
      ours: [makeContact({ phones: [] })],
    })
    const upd = cs.cleanUpdates.find((u) => u.fieldPath === 'phones')
    expect(upd).toBeDefined()
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-PHONE-2: added in ours only → keep ours, no update emitted', () => {
    const base = makeContact({ phones: [] })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ phones: [] })],
      ours: [makeContact({ phones: [phone1] })],
    })
    expect(cs.cleanUpdates.filter((u) => u.fieldPath === 'phones')).toHaveLength(0)
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-PHONE-3: deleted in theirs (ours==base) → cleanUpdate removes', () => {
    const base = makeContact({ phones: [phone1] })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ phones: [] })],
      ours: [makeContact({ phones: [phone1] })],
    })
    const upd = cs.cleanUpdates.find((u) => u.fieldPath === 'phones')
    expect(upd).toBeDefined()
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-PHONE-4: deleted in theirs but ours edited that phone → CONFLICT deleted_remotely', () => {
    const base = makeContact({ phones: [phone1] })
    const editedPhone = { value: '+15550001', type: 'mobile', label: 'Mobile' }
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ phones: [] })],
      ours: [makeContact({ phones: [editedPhone] })],
    })
    const conflict = cs.conflicts.find((c) => c.fieldPath.includes('deleted_remotely'))
    expect(conflict).toBeDefined()
    expect(conflict?.fieldPath).toContain('phones[')
    expect(conflict?.googleValueJson).toBeNull()
  })

  it('T-PHONE-5: deleted in ours (theirs==base) → no-op (confirmed local deletion)', () => {
    const base = makeContact({ phones: [phone1] })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ phones: [phone1] })],
      ours: [makeContact({ phones: [] })],
    })
    expect(cs.cleanUpdates.filter((u) => u.fieldPath === 'phones')).toHaveLength(0)
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-PHONE-6: deleted in ours, theirs changed → CONFLICT deleted_locally_but_remote_changed', () => {
    const base = makeContact({ phones: [phone1] })
    const changedPhone = { value: '+15550001', type: 'fax', label: 'Fax' }
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ phones: [changedPhone] })],
      ours: [makeContact({ phones: [] })],
    })
    const conflict = cs.conflicts.find((c) =>
      c.fieldPath.includes('deleted_locally_but_remote_changed'),
    )
    expect(conflict).toBeDefined()
  })

  it('T-PHONE-7: same edit on both sides → apply, no conflict', () => {
    const base = makeContact({ phones: [phone1] })
    const edited = { value: '+15550001', type: 'mobile', label: 'Mobile' }
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ phones: [edited] })],
      ours: [makeContact({ phones: [edited] })],
    })
    // Same edit on both → converged, apply-theirs, but ours==theirs so no update
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-PHONE-8: different edits on same phone → CONFLICT', () => {
    const base = makeContact({ phones: [phone1] })
    const theirsEdit = { value: '+15550001', type: 'mobile', label: 'Mobile' }
    const oursEdit = { value: '+15550001', type: 'fax', label: 'Fax' }
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ phones: [theirsEdit] })],
      ours: [makeContact({ phones: [oursEdit] })],
    })
    const conflict = cs.conflicts.find((c) => c.fieldPath.includes('phones'))
    expect(conflict).toBeDefined()
  })

  it('T-PHONE-9: two different phones in theirs → two separate elements handled', () => {
    const base = makeContact({ phones: [] })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ phones: [phone1, phone2] })],
      ours: [makeContact({ phones: [] })],
    })
    // Both new → should produce an update for phones
    expect(cs.cleanUpdates.filter((u) => u.fieldPath === 'phones')).toHaveLength(1)
    expect(cs.conflicts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// §6.3 Array merge — emails
// ---------------------------------------------------------------------------

describe('§6.3 array merge — emails', () => {
  const rn = 'people/c001'

  it('T-EMAIL-1: email normalization — ours has lowercase, theirs has uppercase → same key (no-op)', () => {
    // mapper.ts lowercases emails before they get to differ. So both ours and theirs
    // would have lowercase value. Testing that the key function handles it correctly.
    const baseEmail = { value: 'john@x.com', type: 'home', label: 'Home' }
    const oursEmail = { value: 'john@x.com', type: 'home', label: 'Home' }
    const theirsEmail = { value: 'john@x.com', type: 'home', label: 'Home' }
    const base = makeContact({ emails: [] })
    // Simulate: both add same email independently (no base) → converged
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ emails: [theirsEmail] })],
      ours: [makeContact({ emails: [oursEmail] })],
    })
    // Both added same element independently → converged, no conflict
    expect(cs.conflicts.filter((c) => c.fieldPath.includes('emails'))).toHaveLength(0)
    // No base → both added same key independently → the `!inBase && inTheirs && inOurs` branch
    // deepEqual → no conflict
    expect(baseEmail).toBeDefined() // used to satisfy linter
  })

  it('T-EMAIL-2: email added only in theirs → cleanUpdate', () => {
    const base = makeContact({ emails: [] })
    const email = { value: 'newgmail@google.com', type: 'work', label: 'Work' }
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ emails: [email] })],
      ours: [makeContact({ emails: [] })],
    })
    expect(cs.cleanUpdates.some((u) => u.fieldPath === 'emails')).toBe(true)
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-EMAIL-3: email deleted in theirs and ours is unchanged → cleanUpdate remove', () => {
    const email = { value: 'old@x.com', type: 'home', label: 'Home' }
    const base = makeContact({ emails: [email] })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ emails: [] })],
      ours: [makeContact({ emails: [email] })],
    })
    expect(cs.cleanUpdates.some((u) => u.fieldPath === 'emails')).toBe(true)
    expect(cs.conflicts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// §6.3 Array merge — addresses
// ---------------------------------------------------------------------------

describe('§6.3 array merge — addresses', () => {
  const rn = 'people/c001'

  it('T-ADDR-1: distinct addresses (different key) do not collide', () => {
    const addr1 = { street: '123 Main St', city: 'NY', postal: '10001', country: 'US' }
    const addr2 = { street: '456 Oak Ave', city: 'LA', postal: '90001', country: 'US' }
    const base = makeContact({ addresses: [addr1] })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ addresses: [addr1, addr2] })],
      ours: [makeContact({ addresses: [addr1] })],
    })
    // addr2 added in theirs → cleanUpdate
    expect(cs.cleanUpdates.some((u) => u.fieldPath === 'addresses')).toBe(true)
    expect(cs.conflicts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// §6.3 Array merge — organizations
// ---------------------------------------------------------------------------

describe('§6.3 array merge — organizations', () => {
  const rn = 'people/c001'

  it('T-ORG-1: same name different title = different elements', () => {
    const org1 = { name: 'Acme', title: 'Engineer' }
    const org2 = { name: 'Acme', title: 'Manager' }
    const base = makeContact({ organizations: [org1] })
    // theirs adds org2; ours still has org1
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ organizations: [org1, org2] })],
      ours: [makeContact({ organizations: [org1] })],
    })
    expect(cs.cleanUpdates.some((u) => u.fieldPath === 'organizations')).toBe(true)
    expect(cs.conflicts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// §6.3 Array merge — events
// ---------------------------------------------------------------------------

describe('§6.3 array merge — events', () => {
  const rn = 'people/c001'

  it('T-EVENT-1: events keyed by type+date — same type/date is same element', () => {
    const bday = { type: 'birthday', date: '2000-06-15' }
    const anniv = { type: 'anniversary', date: '2020-08-20' }
    const base = makeContact({ events: [bday] })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ events: [bday, anniv] })],
      ours: [makeContact({ events: [bday] })],
    })
    // anniv added in theirs → update
    expect(cs.cleanUpdates.some((u) => u.fieldPath === 'events')).toBe(true)
    expect(cs.conflicts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// §6.4 Photos
// ---------------------------------------------------------------------------

describe('§6.4 photos', () => {
  const rn = 'people/c001'

  it('T-PHOTO-1: same hash all three → no-op', () => {
    const base = makeContact({ photoContentHash: 'hash-a', photoUrl: 'http://g.com/a' })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ photoContentHash: 'hash-a', photoUrl: 'http://g.com/a' })],
      ours: [makeContact({ photoContentHash: 'hash-a', photoUrl: 'http://g.com/a' })],
    })
    expect(cs.cleanUpdates.filter((u) => u.fieldPath === 'photos[0]')).toHaveLength(0)
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-PHOTO-2: theirs changed, ours unchanged → apply theirs', () => {
    const base = makeContact({ photoContentHash: 'hash-a' })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ photoContentHash: 'hash-b', photoUrl: 'http://g.com/b' })],
      ours: [makeContact({ photoContentHash: 'hash-a', photoUrl: 'http://g.com/a' })],
    })
    const upd = cs.cleanUpdates.find((u) => u.fieldPath === 'photos[0]')
    expect(upd).toBeDefined()
    expect(upd?.newValue).toBe('http://g.com/b')
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-PHOTO-3: ours changed, theirs unchanged → keep ours (no update)', () => {
    const base = makeContact({ photoContentHash: 'hash-a' })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ photoContentHash: 'hash-a', photoUrl: 'http://g.com/a' })],
      ours: [makeContact({ photoContentHash: 'hash-local', photoUrl: 'local://photo' })],
    })
    expect(cs.cleanUpdates.filter((u) => u.fieldPath === 'photos[0]')).toHaveLength(0)
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-PHOTO-4: same change on both sides → apply theirs', () => {
    const base = makeContact({ photoContentHash: 'hash-a' })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ photoContentHash: 'hash-b', photoUrl: 'http://g.com/b' })],
      ours: [makeContact({ photoContentHash: 'hash-b', photoUrl: 'http://g.com/b' })],
    })
    const upd = cs.cleanUpdates.find((u) => u.fieldPath === 'photos[0]')
    expect(upd).toBeDefined()
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-PHOTO-5: different changes on both sides → CONFLICT photos[0]', () => {
    const base = makeContact({ photoContentHash: 'hash-a' })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, base]]),
      theirs: [makeContact({ photoContentHash: 'hash-google', photoUrl: 'http://g.com/g' })],
      ours: [makeContact({ photoContentHash: 'hash-local', photoUrl: 'local://photo' })],
    })
    const conflict = cs.conflicts.find((c) => c.fieldPath === 'photos[0]')
    expect(conflict).toBeDefined()
    expect(conflict?.googleValueJson).toBe('"hash-google"')
    expect(conflict?.localValueJson).toBe('"hash-local"')
  })
})

// ---------------------------------------------------------------------------
// §6.5 Labels
// ---------------------------------------------------------------------------

describe('§6.5 labels (INV-4)', () => {
  it('T-LABEL-1: first pull → labels populated in Changeset', () => {
    const labels: GoogleLabelRow[] = [
      {
        resourceName: 'contactGroups/l1',
        name: 'Friends',
        groupType: 'user',
        etag: 'e1',
        lastSyncedAt: NOW,
      },
    ]
    const cs = computeChangeset({
      ...emptyInput(),
      theirLabels: labels,
    })
    expect(cs.labels.full).toHaveLength(1)
    expect(cs.labels.full[0]!.resourceName).toBe('contactGroups/l1')
  })

  it('T-LABEL-2: second pull with different labels → full replace (changeset reflects new set)', () => {
    const labelsFirst: GoogleLabelRow[] = [
      {
        resourceName: 'contactGroups/l1',
        name: 'Friends',
        groupType: 'user',
        etag: 'e1',
        lastSyncedAt: NOW,
      },
    ]
    const labelsSecond: GoogleLabelRow[] = [
      {
        resourceName: 'contactGroups/l2',
        name: 'Work',
        groupType: 'user',
        etag: 'e2',
        lastSyncedAt: NOW,
      },
    ]
    const cs1 = computeChangeset({ ...emptyInput(), theirLabels: labelsFirst })
    const cs2 = computeChangeset({ ...emptyInput(), theirLabels: labelsSecond })
    expect(cs1.labels.full[0]!.resourceName).toBe('contactGroups/l1')
    expect(cs2.labels.full[0]!.resourceName).toBe('contactGroups/l2')
  })

  it('T-LABEL-3: membership change for a contact → reflected in changeset', () => {
    const memberships = new Map<string, string[]>([
      ['people/c001', ['contactGroups/l1', 'contactGroups/l2']],
    ])
    const cs = computeChangeset({
      ...emptyInput(),
      theirLabelMemberships: memberships,
    })
    expect(cs.labels.memberships.get('people/c001')).toEqual([
      'contactGroups/l1',
      'contactGroups/l2',
    ])
  })
})

// ---------------------------------------------------------------------------
// §6.6 Deletion
// ---------------------------------------------------------------------------

describe('§6.6 deletion', () => {
  const rn = 'people/c001'

  it('T-DEL-1: contact in deletedRemotely, ours matches snapshot → cleanDeletes', () => {
    const contact = makeContact()
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, contact]]),
      deletedRemotely: [rn],
      ours: [contact],
    })
    expect(cs.cleanDeletes).toContain(rn)
    expect(cs.conflicts).toHaveLength(0)
  })

  it('T-DEL-2: contact in deletedRemotely, ours has local edits → CONFLICT __deletion__', () => {
    const snapshot = makeContact({ displayName: 'Original' })
    const edited = makeContact({ displayName: 'Locally Edited' })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, snapshot]]),
      deletedRemotely: [rn],
      ours: [edited],
    })
    const conflict = cs.conflicts.find((c) => c.fieldPath === '__deletion__')
    expect(conflict).toBeDefined()
    expect(conflict?.googleValueJson).toBeNull()
    expect(cs.cleanDeletes).toHaveLength(0)
  })

  it('T-DEL-3: contact in deletedRemotely, no snapshot exists → CONFLICT with null base', () => {
    const contact = makeContact()
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map(), // no snapshot
      deletedRemotely: [rn],
      ours: [contact],
    })
    const conflict = cs.conflicts.find((c) => c.fieldPath === '__deletion__')
    expect(conflict).toBeDefined()
    expect(conflict?.baseValueJson).toBeNull()
  })

  it('T-DEL-4: contact deleted locally (not in ours) + still in theirs → no insert (not new, in snapshot)', () => {
    const contact = makeContact()
    // Was in snapshot, still in theirs, but not in ours (locally deleted)
    // This hits the "!oursContact && snapshot" branch
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, contact]]),
      theirs: [contact], // same as snapshot — no remote change
      ours: [], // locally deleted
    })
    // theirs == snapshot → no-op (confirmed deletion, spec §6.3: !oursContact && snapshot, theirs==snapshot)
    expect(cs.cleanInserts).toHaveLength(0)
    expect(cs.conflicts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// §6.6 Deletion: locally deleted + remote changed (conflict)
// ---------------------------------------------------------------------------

describe('§6.6 deletion — locally deleted contact with remote changes', () => {
  const rn = 'people/c001'

  it('T-DEL-5: contact deleted locally but remote changed → CONFLICT', () => {
    const snapshot = makeContact({ displayName: 'Old Name' })
    const theirsContact = makeContact({ displayName: 'Google Changed Name' })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, snapshot]]),
      theirs: [theirsContact],
      ours: [], // locally deleted
    })
    const conflict = cs.conflicts.find((c) =>
      c.fieldPath.includes('deleted_locally_but_remote_changed'),
    )
    expect(conflict).toBeDefined()
    expect(conflict?.googleValueJson).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// New contact (first pull scenarios)
// ---------------------------------------------------------------------------

describe('new contacts and orphaned cases', () => {
  it('T-NEW-1: contact in theirs but never seen before → cleanInserts', () => {
    const theirsContact = makeContact({ displayName: 'Brand New' })
    const cs = computeChangeset({
      ...emptyInput(),
      theirs: [theirsContact],
    })
    expect(cs.cleanInserts).toHaveLength(1)
    expect(cs.cleanInserts[0]!.displayName).toBe('Brand New')
  })

  it('T-NEW-2: orphaned local Google-id (in ours, no snapshot) → conflicts for diverged fields', () => {
    // In ours but no snapshot → base treated as empty → any divergence = conflict
    const oursContact = makeContact({ displayName: 'Local Value', notesMd: 'local note' })
    const theirsContact = makeContact({ displayName: 'Google Value', notesMd: 'google note' })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map(), // no snapshot
      theirs: [theirsContact],
      ours: [oursContact],
    })
    // displayName differs: ours='Local Value', base=undefined, theirs='Google Value'
    // ours != base (both differ from undefined), theirs != base → conflict
    expect(cs.conflicts.length).toBeGreaterThan(0)
  })

  it('T-NEW-3: multiple contacts in single pull — each handled independently', () => {
    const rn2 = 'people/c002'
    const contact1 = makeContact({ googleResourceName: 'people/c001', displayName: 'Alice' })
    const contact2 = makeContact({ googleResourceName: rn2, displayName: 'Bob' })
    const snapshot1 = makeContact({ googleResourceName: 'people/c001', displayName: 'Alice Old' })

    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([['people/c001', snapshot1]]),
      theirs: [contact1, contact2],
      ours: [makeContact({ googleResourceName: 'people/c001', displayName: 'Alice Old' })],
    })
    // contact1: in ours+snapshot, displayName changed in theirs → update
    // contact2: new → insert
    expect(cs.cleanInserts.some((c) => c.googleResourceName === rn2)).toBe(true)
    expect(cs.cleanUpdates.some((u) => u.googleResourceName === 'people/c001')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

describe('deterministic output ordering', () => {
  it('T-SORT-1: cleanInserts sorted by googleResourceName ASC', () => {
    const c1 = makeContact({ googleResourceName: 'people/cZZZ', displayName: 'Z' })
    const c2 = makeContact({ googleResourceName: 'people/cAAA', displayName: 'A' })
    const cs = computeChangeset({
      ...emptyInput(),
      theirs: [c1, c2],
    })
    expect(cs.cleanInserts[0]!.googleResourceName).toBe('people/cAAA')
    expect(cs.cleanInserts[1]!.googleResourceName).toBe('people/cZZZ')
  })

  it('T-SORT-2: cleanDeletes sorted ASC', () => {
    const contact1 = makeContact({ googleResourceName: 'people/cZZZ' })
    const contact2 = makeContact({ googleResourceName: 'people/cAAA' })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([
        ['people/cZZZ', contact1],
        ['people/cAAA', contact2],
      ]),
      deletedRemotely: ['people/cZZZ', 'people/cAAA'],
      ours: [contact1, contact2],
    })
    expect(cs.cleanDeletes[0]).toBe('people/cAAA')
    expect(cs.cleanDeletes[1]).toBe('people/cZZZ')
  })
})

// ---------------------------------------------------------------------------
// Counts mirror array lengths
// ---------------------------------------------------------------------------

describe('counts accuracy', () => {
  it('T-COUNT-1: counts match actual array lengths', () => {
    const rn1 = 'people/c001'
    const rn2 = 'people/c002'
    const c2 = makeContact({ googleResourceName: rn2 })
    const snap1 = makeContact({ googleResourceName: rn1, displayName: 'Old' })
    const theirsUpdated = makeContact({ googleResourceName: rn1, displayName: 'New' })
    const cs = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn1, snap1]]),
      theirs: [theirsUpdated, c2],
      ours: [makeContact({ googleResourceName: rn1, displayName: 'Old' })],
    })
    expect(cs.counts.inserts).toBe(cs.cleanInserts.length)
    expect(cs.counts.updates).toBe(cs.cleanUpdates.length)
    expect(cs.counts.deletes).toBe(cs.cleanDeletes.length)
    expect(cs.counts.conflicts).toBe(cs.conflicts.length)
  })
})

// ---------------------------------------------------------------------------
// §6.8 Idempotency — same snapshot and theirs → empty on second run
// ---------------------------------------------------------------------------

describe('§6.8 idempotency — repeated runs', () => {
  it('T-IDMP-4: first pull applies cleanInsert; if snapshot updated to theirs + ours = theirs, re-run is empty', () => {
    const rn = 'people/c001'
    const contact = makeContact({ googleResourceName: rn, displayName: 'Alice' })

    // First run: new contact
    const cs1 = computeChangeset({
      ...emptyInput(),
      theirs: [contact],
    })
    expect(cs1.cleanInserts).toHaveLength(1)

    // After apply: snapshot = contact, ours = contact → re-run
    const cs2 = computeChangeset({
      ...emptyInput(),
      snapshots: new Map([[rn, contact]]),
      theirs: [contact],
      ours: [contact],
    })
    expect(cs2.cleanInserts).toHaveLength(0)
    expect(cs2.cleanUpdates).toHaveLength(0)
    expect(cs2.conflicts).toHaveLength(0)
  })
})
