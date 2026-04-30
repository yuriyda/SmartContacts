// Round-trip tests for contactTaskToRow / rowToContactTask.
// Covers: open task, done task, all optional fields, tombstone, invalid priority, missing required column.

import { describe, expect, test } from 'vitest'
import { contactTaskToRow, rowToContactTask } from './contactTaskRow'
import type { ContactTask } from '../types'

const openTask: ContactTask = {
  id: '01HX0000000000000000000020',
  contactId: '01HX0000000000000000000001',
  text: 'Follow up on contract',
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
  lamportTs: 1,
  deviceId: 'DEV1',
}

const doneTask: ContactTask = {
  id: '01HX0000000000000000000021',
  contactId: '01HX0000000000000000000001',
  text: 'Send welcome email',
  doneAt: '2026-04-30T09:00:00.000Z',
  createdAt: '2026-04-29T00:00:00.000Z',
  updatedAt: '2026-04-30T09:00:00.000Z',
  lamportTs: 8,
  deviceId: 'DEV1',
}

const fullTask: ContactTask = {
  id: '01HX0000000000000000000022',
  contactId: '01HX0000000000000000000002',
  text: 'Prepare proposal',
  dueAt: '2026-05-15T00:00:00.000Z',
  priority: 2,
  doneAt: '2026-04-30T14:00:00.000Z',
  createdAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-30T14:00:00.000Z',
  lamportTs: 15,
  deviceId: 'DEV2',
}

const tombstoneTask: ContactTask = {
  id: '01HX0000000000000000000023',
  contactId: '01HX0000000000000000000001',
  text: 'Old task',
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
  deletedAt: '2026-04-30T00:00:00.000Z',
  lamportTs: 20,
  deviceId: 'DEV1',
}

describe('contactTaskRow round-trip', () => {
  test('open task (no doneAt, no dueAt, no priority) round-trips deep-equal', () => {
    expect(rowToContactTask(contactTaskToRow(openTask))).toEqual(openTask)
  })

  test('done task (doneAt set) round-trips deep-equal', () => {
    expect(rowToContactTask(contactTaskToRow(doneTask))).toEqual(doneTask)
  })

  test('task with all optional fields filled round-trips deep-equal', () => {
    expect(rowToContactTask(contactTaskToRow(fullTask))).toEqual(fullTask)
  })

  test('tombstone task (deletedAt set) round-trips deep-equal', () => {
    expect(rowToContactTask(contactTaskToRow(tombstoneTask))).toEqual(tombstoneTask)
  })

  test('row with invalid priority 0 throws', () => {
    const row = { ...contactTaskToRow(openTask), priority: 0 }
    expect(() => rowToContactTask(row)).toThrow(/invalid priority/i)
  })

  test('row with invalid priority 6 throws', () => {
    const row = { ...contactTaskToRow(openTask), priority: 6 }
    expect(() => rowToContactTask(row)).toThrow(/invalid priority/i)
  })

  test('row missing required column (id) throws', () => {
    const row = contactTaskToRow(openTask)
    delete row['id']
    expect(() => rowToContactTask(row)).toThrow(/missing required/i)
  })

  test('row missing text throws', () => {
    const row = contactTaskToRow(openTask)
    delete row['text']
    expect(() => rowToContactTask(row)).toThrow(/missing required/i)
  })

  test('row missing contact_id throws', () => {
    const row = contactTaskToRow(openTask)
    delete row['contact_id']
    expect(() => rowToContactTask(row)).toThrow(/missing required/i)
  })

  test('optional fields absent in open task row (not set as undefined key)', () => {
    const row = contactTaskToRow(openTask)
    expect('due_at' in row).toBe(false)
    expect('priority' in row).toBe(false)
    expect('done_at' in row).toBe(false)
    expect('deleted_at' in row).toBe(false)
  })

  test.each([1, 2, 3, 4, 5] as const)('priority %i round-trips', (priority) => {
    const task: ContactTask = { ...openTask, priority }
    expect(rowToContactTask(contactTaskToRow(task))).toEqual(task)
  })
})
