/**
 * @file useFilteredContacts.ts
 * Thin React hook that applies ContactFilters to a contact list and returns the visible subset.
 * Rules: no UI imports; only React, shared types, and filterTypes.
 * All filter logic lives in shared/src/core/contactFilter.ts (applyContactFilters).
 *
 * Hidden-scope behaviour summary (enforced in applyContactFilters):
 *  - scope='hidden' → only alive+hidden contacts; search also scans hidden-alive.
 *  - scope='trash'  → deleted contacts regardless of hidden flag.
 *  - any other scope → excludes hidden contacts; search excludes hidden too.
 */
import { useMemo } from 'react'
import type { Contact } from '@smart-contacts/shared'
import { applyContactFilters } from '@smart-contacts/shared'
import type { ContactFilters } from './filterTypes'

export function useFilteredContacts(contacts: Contact[], filters: ContactFilters): Contact[] {
  return useMemo(() => applyContactFilters(contacts, filters), [contacts, filters])
}
