/**
 * @file SearchScreen.tsx
 * Mobile contact search. Live results as user types; tap row → /contact/:id.
 * Reuses useFilteredContacts from web (alive non-hidden contacts only).
 * Spec §22.5: read-only; no scope/filter sidebar.
 *
 * Rules:
 *  - No multi-select, no bulk ops (spec §22.5).
 *  - Touch-friendly: tap targets ≥ 44px.
 *  - No DB access; reads through useContacts hook.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { DbState } from '@smart-contacts/web'
import { useContacts } from '@smart-contacts/web/store/useContacts'
import { useFilteredContacts } from '@smart-contacts/web/ui/useFilteredContacts'
import { ContactAvatar } from '@smart-contacts/web/ui/ContactAvatar'

export function SearchScreen({ dbState }: { dbState: DbState }) {
  const { contacts } = useContacts(dbState.contactsRepo)
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const nav = useNavigate()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useFilteredContacts(contacts, {
    scope: 'all',
    group: null,
    tag: null,
    search: q.trim(),
  })

  return (
    <div className="h-full flex flex-col bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 px-3 py-2 flex items-center gap-2">
        <Search size={18} className="text-slate-400 flex-shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search contacts…"
          className="flex-1 px-2 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-slate-100 focus:outline-none focus:border-sky-500"
        />
      </header>
      <div className="flex-1 overflow-y-auto pb-20">
        {q.trim() === '' ? (
          <div className="p-6 text-center text-slate-400 text-sm">Type to search.</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-sm">No matches.</div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {filtered.map((c) => {
              const name =
                c.displayName ?? (`${c.givenName ?? ''} ${c.familyName ?? ''}`.trim() || 'Unnamed')
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => nav(`/contact/${c.id}`)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800 active:bg-slate-700 min-h-[56px]"
                  >
                    <ContactAvatar id={c.id} name={name} size={36} />
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-sm text-slate-100 truncate">{name}</div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
