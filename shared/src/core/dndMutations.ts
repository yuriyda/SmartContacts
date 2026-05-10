/**
 * @file dndMutations.ts
 * Pure mutation helpers for drag-and-drop operations: add contact to group, tag, or organization.
 * Rules:
 *   - All functions are pure — they return a new Contact and never mutate the input.
 *   - Idempotent: re-adding an already-present membership is a no-op (returns same reference).
 *   - Do NOT touch lamportTs / updatedAt / createdAt — those are set by contactsRepo.upsert.
 *   - Do NOT import from the web package or any side-effectful module.
 */
import type { Contact, GroupMembership } from '../types'

/**
 * Move the contact to the given group — REPLACE semantics, not append.
 * A contact can be in at most one group at a time (product invariant).
 * Tags allow multi-membership; groups don't.
 *
 * Returns the same reference if the contact is already in this group AND no
 * other groups (already correctly settled). Otherwise returns a new Contact
 * with `groups` set to a single-entry array.
 */
export function addContactToGroup(c: Contact, g: GroupMembership): Contact {
  const existing = c.groups ?? []
  if (existing.length === 1 && existing[0]!.id === g.id) return c
  // Spread only defined properties to satisfy exactOptionalPropertyTypes.
  const entry: GroupMembership = g.name !== undefined ? { id: g.id, name: g.name } : { id: g.id }
  return { ...c, groups: [entry] }
}

/**
 * Append the tag to contact.tags if not already present (case-sensitive match).
 * Returns a new Contact object; returns the same reference if tag already exists.
 */
export function addContactToTag(c: Contact, name: string): Contact {
  const existing = c.tags ?? []
  if (existing.includes(name)) return c
  return { ...c, tags: [...existing, name] }
}

/**
 * Append an organization entry with current=false if no entry already has the given name
 * (case-sensitive name match, regardless of current/title/etc. of existing entries).
 * Returns a new Contact object; returns the same reference if org already exists.
 */
export function addContactToOrganization(c: Contact, name: string): Contact {
  const existing = c.organizations ?? []
  if (existing.some((o) => o.name === name)) return c
  return { ...c, organizations: [...existing, { name, current: false }] }
}
