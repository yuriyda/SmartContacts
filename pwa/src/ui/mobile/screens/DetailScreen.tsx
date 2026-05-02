/**
 * @file DetailScreen.tsx
 * Mobile contact detail. Reuses web's ContactDetail body.
 * Header: back button + edit button + delete button.
 *
 * Scope (§22.5):
 *  - No protect/hide toggles in mobile header (explicit exclusion).
 *  - No bulk operations, no multi-select, no undo.
 *  - Touch targets ≥ 44px (header buttons w-11/h-11).
 *
 * Note: window.confirm used for delete confirmation — system-native is acceptable on mobile.
 * The web's useConfirm() requires a Mount context that is not wired in the mobile shell.
 *
 * Rules:
 *  - No DB access; reads through useContacts hook.
 *  - ContactDetail receives empty defs array; custom field rendering is empty in mobile.
 *    T8 can wire defsRepo if needed.
 */
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit3, Trash2 } from 'lucide-react'
import type { Contact } from '@smart-contacts/shared'
import type { DbState } from '@smart-contacts/web'
import { useContacts } from '@smart-contacts/web/store/useContacts'
import { ContactDetail } from '@smart-contacts/web/ui/ContactDetail'

export function DetailScreen({ dbState }: { dbState: DbState }) {
  const { id } = useParams<{ id: string }>()
  const { contacts, softDelete } = useContacts(dbState.contactsRepo)
  const nav = useNavigate()

  const contact = contacts.find((c: Contact) => c.id === id) ?? null

  if (!contact) {
    return (
      <div className="h-full flex flex-col bg-slate-900">
        <MobileBackHeader title="" onBack={() => nav('/list')} />
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Contact not found
        </div>
      </div>
    )
  }

  const onDelete = async () => {
    if (!window.confirm('Delete this contact?')) return
    await softDelete(contact.id)
    nav('/list')
  }

  return (
    <div className="h-full flex flex-col bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 flex items-center px-2 py-2 gap-2">
        <button
          type="button"
          onClick={() => nav('/list')}
          aria-label="Back"
          className="w-11 h-11 flex items-center justify-center text-slate-300 hover:bg-slate-700 rounded"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="flex-1 text-base font-semibold text-slate-100 truncate">
          {contact.displayName ?? 'Contact'}
        </h1>
        <button
          type="button"
          onClick={() => nav(`/contact/${contact.id}/edit`)}
          aria-label="Edit"
          className="w-11 h-11 flex items-center justify-center text-slate-300 hover:bg-slate-700 rounded"
        >
          <Edit3 size={18} />
        </button>
        <button
          type="button"
          onClick={() => void onDelete()}
          aria-label="Delete"
          className="w-11 h-11 flex items-center justify-center text-red-400 hover:bg-slate-700 rounded"
        >
          <Trash2 size={18} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto pb-20">
        {/* width=undefined → ContactDetail uses default 420px; on mobile it overflows
            and the parent flex item clips it, which is fine for this iteration.
            T8 can adjust layout if needed. */}
        <ContactDetail
          contact={contact}
          defs={[]}
          allContacts={contacts}
          onEdit={() => nav(`/contact/${contact.id}/edit`)}
          onTouch={() => undefined}
          onDelete={() => void onDelete()}
          onRestore={() => undefined}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function MobileBackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="bg-slate-800 border-b border-slate-700 flex items-center px-2 py-2 gap-2">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="w-11 h-11 flex items-center justify-center text-slate-300 hover:bg-slate-700 rounded"
      >
        <ArrowLeft size={20} />
      </button>
      <h1 className="flex-1 text-base font-semibold text-slate-100 truncate">{title}</h1>
    </header>
  )
}
