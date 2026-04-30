// Round-trip tests for interactionToRow / rowToInteraction.
// Covers: minimal, full, tombstone, all channel values, invalid channel, missing required column.

import { describe, expect, test } from 'vitest'
import { interactionToRow, rowToInteraction } from './interactionRow'
import type { Interaction } from '../types'

const minimal: Interaction = {
  id: '01HX0000000000000000000010',
  contactId: '01HX0000000000000000000001',
  at: '2026-04-30T10:00:00.000Z',
  channel: 'call',
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
  lamportTs: 1,
  deviceId: 'DEV1',
}

const full: Interaction = {
  id: '01HX0000000000000000000011',
  contactId: '01HX0000000000000000000001',
  at: '2026-04-30T11:00:00.000Z',
  channel: 'meet',
  noteMd: '## Meeting notes\n- discussed project',
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
  lamportTs: 5,
  deviceId: 'DEV2',
}

const tombstone: Interaction = {
  id: '01HX0000000000000000000012',
  contactId: '01HX0000000000000000000001',
  at: '2026-04-29T08:00:00.000Z',
  channel: 'email',
  createdAt: '2026-04-29T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
  deletedAt: '2026-04-30T00:00:00.000Z',
  lamportTs: 10,
  deviceId: 'DEV1',
}

describe('interactionRow round-trip', () => {
  test('minimal interaction (required fields only) round-trips deep-equal', () => {
    expect(rowToInteraction(interactionToRow(minimal))).toEqual(minimal)
  })

  test('full interaction with noteMd set round-trips deep-equal', () => {
    expect(rowToInteraction(interactionToRow(full))).toEqual(full)
  })

  test('tombstone interaction (deletedAt set) round-trips deep-equal', () => {
    expect(rowToInteraction(interactionToRow(tombstone))).toEqual(tombstone)
  })

  test.each(['call', 'meet', 'message', 'email', 'social', 'other'] as const)(
    'channel %s round-trips',
    (channel) => {
      const i: Interaction = {
        ...minimal,
        id: `01HX000000000000000000002${channel.length}`,
        channel,
      }
      expect(rowToInteraction(interactionToRow(i))).toEqual(i)
    },
  )

  test('row with invalid channel throws', () => {
    const row = { ...interactionToRow(minimal), channel: 'fax' }
    expect(() => rowToInteraction(row)).toThrow(/invalid channel/i)
  })

  test('row missing required column (id) throws', () => {
    const row = interactionToRow(minimal)
    delete row['id']
    expect(() => rowToInteraction(row)).toThrow(/missing required/i)
  })

  test('row missing contact_id throws', () => {
    const row = interactionToRow(minimal)
    delete row['contact_id']
    expect(() => rowToInteraction(row)).toThrow(/missing required/i)
  })

  test('row missing at throws', () => {
    const row = interactionToRow(minimal)
    delete row['at']
    expect(() => rowToInteraction(row)).toThrow(/missing required/i)
  })

  test('row missing channel throws', () => {
    const row = interactionToRow(minimal)
    delete row['channel']
    expect(() => rowToInteraction(row)).toThrow(/missing required/i)
  })

  test('noteMd absent in minimal row (not set as undefined key)', () => {
    const row = interactionToRow(minimal)
    expect('note_md' in row).toBe(false)
  })

  test('deletedAt absent in minimal row (not set as undefined key)', () => {
    const row = interactionToRow(minimal)
    expect('deleted_at' in row).toBe(false)
  })
})
