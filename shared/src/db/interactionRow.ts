// Row mapper for the `interactions` SQLite table.
// Converts between Interaction (TS, camelCase) and flat DB rows (snake_case).
// Rules:
//   - Do NOT import runtime logic from outside this file except Interaction/InteractionChannel types.
//   - Encoding/decoding must be lossless: rowToInteraction(interactionToRow(i)) deep-equals i.
//   - Required fields missing in a row cause a thrown Error (fast-fail, not silent corruption).
//   - Optional fields use omit-when-undefined pattern (key absent ↔ field undefined).
//   - channel must be one of the VALID_CHANNELS set; unknown values throw.

import type { Interaction, InteractionChannel } from '../types'

// ---------------------------------------------------------------------------
// Channel validation
// ---------------------------------------------------------------------------

const VALID_CHANNELS: ReadonlySet<InteractionChannel> = new Set([
  'call',
  'meet',
  'message',
  'email',
  'social',
  'other',
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Require a column in the row; throw a descriptive error if absent. */
function requireCol(row: Record<string, unknown>, col: string): unknown {
  if (!(col in row)) {
    throw new Error(`interactionRow: missing required column ${col}`)
  }
  return row[col]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Encode an Interaction into a flat row matching the `interactions` DDL. */
export function interactionToRow(i: Interaction): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: i.id,
    contact_id: i.contactId,
    at: i.at,
    channel: i.channel,
    created_at: i.createdAt,
    updated_at: i.updatedAt,
    lamport_ts: i.lamportTs,
    device_id: i.deviceId,
  }
  // Optional fields: omit key when undefined (preserves round-trip under exactOptionalPropertyTypes)
  if (i.noteMd !== undefined) row['note_md'] = i.noteMd
  if (i.deletedAt !== undefined) row['deleted_at'] = i.deletedAt
  return row
}

/** Decode a row from `interactions` back into an Interaction (deep-equal round-trip). */
export function rowToInteraction(row: Record<string, unknown>): Interaction {
  // Validate required columns first (fast-fail)
  const id = requireCol(row, 'id') as string
  const contactId = requireCol(row, 'contact_id') as string
  const at = requireCol(row, 'at') as string
  const rawChannel = requireCol(row, 'channel')
  const createdAt = requireCol(row, 'created_at') as string
  const updatedAt = requireCol(row, 'updated_at') as string
  const lamportTs = requireCol(row, 'lamport_ts') as number
  const deviceId = requireCol(row, 'device_id') as string

  // Validate channel value
  if (!VALID_CHANNELS.has(rawChannel as InteractionChannel)) {
    throw new Error(
      `interactionRow: invalid channel "${String(rawChannel)}" — must be one of ${[...VALID_CHANNELS].join(', ')}`,
    )
  }
  const channel = rawChannel as InteractionChannel

  const interaction: Interaction = {
    id,
    contactId,
    at,
    channel,
    createdAt,
    updatedAt,
    lamportTs,
    deviceId,
  }

  // Optional text fields: omit from result when key absent or null
  if ('note_md' in row && row['note_md'] != null) interaction.noteMd = String(row['note_md'])
  if ('deleted_at' in row && row['deleted_at'] != null)
    interaction.deletedAt = String(row['deleted_at'])

  return interaction
}
