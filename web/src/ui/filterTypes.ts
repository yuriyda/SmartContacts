/**
 * @file filterTypes.ts
 * Shared filter state model for Smart Contacts list views.
 * Consumed by Sidebar, useFilteredContacts, and SmartContactsApp.
 * Rules: no React imports here — pure TypeScript types only.
 */

/** Describes the active filter state for the contacts list. */
export interface ContactFilters {
  /** Mutually exclusive scope selector (like radio buttons). */
  scope: 'all' | 'starred' | 'recent' | 'birthdays' | 'trash'
  /** Group id to further narrow scope, or null for no group filter. */
  group: string | null
  /** Tag name to further narrow scope, or null for no tag filter. */
  tag: string | null
  /** Organization name to further narrow scope; undefined means no org filter. */
  organization?: string
  /** Free-text search query; non-empty overrides scope/group/tag (searches alive contacts only). */
  search: string
}

/** Default "show everything" filter. */
export const DEFAULT_FILTERS: ContactFilters = {
  scope: 'all',
  group: null,
  tag: null,
  search: '',
}
