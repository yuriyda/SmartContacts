/**
 * @file ListScreen.tsx
 * Mobile contacts list. Renders all alive contacts via useContacts.
 * FAB at bottom-right navigates to /contact/new.
 * Tap row navigates to /contact/:id.
 *
 * Scope (§22.5):
 *  - All scope only; no Hidden, Trash, Birthdays, Recent, Starred filters.
 *  - No multi-select; no checkbox column.
 *  - Long-press not supported.
 *  - No bulk operations, no undo.
 *
 * Rules:
 *  - Touch targets ≥ 44px (row min-h-[56px], FAB w-14/h-14).
 *  - No DB access; reads through useContacts hook.
 */
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import type { Contact } from '@smart-contacts/shared'
import type { DbState } from '@smart-contacts/web'
import { useContacts } from '@smart-contacts/web/store/useContacts'
import { ContactAvatar } from '@smart-contacts/web/ui/ContactAvatar'

export function ListScreen({ dbState }: { dbState: DbState }) {
  const { contacts, loading } = useContacts(dbState.contactsRepo)
  const nav = useNavigate()

  if (loading) {
    return <div className="h-full flex items-center justify-center text-slate-300">Loading…</div>
  }

  const alive = contacts.filter((c: Contact) => !c.deletedAt && !c.hidden)

  return (
    <div className="h-full overflow-y-auto bg-slate-900 relative pb-20">
      <header className="sticky top-0 bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center">
        <h1 className="text-base font-semibold text-slate-100">Contacts ({alive.length})</h1>
      </header>
      {alive.length === 0 ? (
        <div className="p-6 text-center text-slate-400 text-sm">No contacts yet. Tap + to add.</div>
      ) : (
        <ul className="divide-y divide-slate-800">
          {alive.map((c: Contact) => {
            const name =
              c.displayName ?? (`${c.givenName ?? ''} ${c.familyName ?? ''}`.trim() || 'Unnamed')
            const primaryPhone = c.phones?.find((p) => p.primary)?.value ?? c.phones?.[0]?.value
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => nav(`/contact/${c.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800 active:bg-slate-700 min-h-[56px]"
                >
                  <ContactAvatar id={c.id} name={name} size={40} />
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-sm text-slate-100 truncate">{name}</div>
                    {primaryPhone && (
                      <div className="text-xs text-slate-400 truncate">{primaryPhone}</div>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {/* FAB: 56×56 satisfies ≥44px touch target */}
      <button
        type="button"
        onClick={() => nav('/contact/new')}
        aria-label="Add contact"
        className="fixed bottom-20 right-4 w-14 h-14 rounded-full bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white flex items-center justify-center shadow-lg"
      >
        <Plus size={24} />
      </button>
    </div>
  )
}
