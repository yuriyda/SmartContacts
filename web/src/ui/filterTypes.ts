/**
 * @file filterTypes.ts
 * Shared filter state model for Smart Contacts list views.
 * Consumed by Sidebar, useFilteredContacts, and SmartContactsApp.
 * Rules: no React imports here — pure TypeScript types only.
 */

/** Describes the active filter state for the contacts list. */
export interface ContactFilters {
  /** Mutually exclusive scope selector (like radio buttons). */
  scope: 'all' | 'starred' | 'recent' | 'birthdays' | 'trash' | 'hidden'
  /** Group id to further narrow scope, or null for no group filter. */
  group: string | null
  /** Tag name to further narrow scope, or null for no tag filter. */
  tag: string | null
  /** Organization name to further narrow scope; undefined means no org filter. */
  organization?: string
  /** Free-text search query; non-empty overrides scope/group/tag (searches alive contacts only). */
  search: string
  /** When true, restrict the list to contacts that have a photo available.
   *  Today the only photo source is Google's snapshot (`photoUrl`), so this is
   *  effectively "has Google photo" — but the field is named generically so
   *  future locally-uploaded avatars will pass through the same filter
   *  without touching call sites. The set of "has-photo" ids is provided by
   *  `useAvatarContactIds` and intersected in SmartContactsApp. */
  hasPhoto?: boolean
}

/** Default "show everything" filter. */
export const DEFAULT_FILTERS: ContactFilters = {
  scope: 'all',
  group: null,
  tag: null,
  search: '',
}
