/**
 * @file EditScreen.tsx
 * Mobile contact edit/add form. Minimal field set per spec §22.5.
 *
 * Fields supported in T4: givenName, familyName, displayName, primary phone,
 * primary email, notes.
 * Deferred to future iteration: addresses, organizations, urls, im_clients,
 * events, custom fields, tags, groups, priority.
 *
 * Scope (§22.5):
 *  - mode='new' renders empty form; mode='edit' loads existing contact by :id param.
 *  - No bulk operations, no multi-select, no undo.
 *  - Touch targets ≥ 44px (header buttons h-11, Save button h-11).
 *
 * Note: window.confirm is NOT used here; cancel navigates back immediately.
 * Unsaved-changes guard is deferred to a future iteration.
 *
 * Rules:
 *  - No DB access; all mutations via useContacts.upsert.
 *  - lamportTs and deviceId are set to sentinel values (0 / '') — repo.upsert overwrites them.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import type { Contact, Phone, Email } from '@smart-contacts/shared'
import { ulid } from '@smart-contacts/shared'
import type { DbState } from '@smart-contacts/web'
import { useContacts } from '@smart-contacts/web/store/useContacts'

interface Props {
  dbState: DbState
  mode: 'new' | 'edit'
}

export function EditScreen({ dbState, mode }: Props) {
  const { id } = useParams<{ id: string }>()
  const { contacts, upsert } = useContacts(dbState.contactsRepo)
  const nav = useNavigate()

  const existing =
    mode === 'edit' && id ? (contacts.find((c: Contact) => c.id === id) ?? null) : null

  const [givenName, setGivenName] = useState(existing?.givenName ?? '')
  const [familyName, setFamilyName] = useState(existing?.familyName ?? '')
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '')
  const [phone, setPhone] = useState(
    existing?.phones?.find((p: Phone) => p.primary)?.value ?? existing?.phones?.[0]?.value ?? '',
  )
  const [email, setEmail] = useState(
    existing?.emails?.find((e: Email) => e.primary)?.value ?? existing?.emails?.[0]?.value ?? '',
  )
  const [notesMd, setNotesMd] = useState(existing?.notesMd ?? '')

  // Re-initialise fields when the existing contact loads (after contacts list populates).
  useEffect(() => {
    if (mode === 'edit' && existing) {
      setGivenName(existing.givenName ?? '')
      setFamilyName(existing.familyName ?? '')
      setDisplayName(existing.displayName ?? '')
      setPhone(
        existing.phones?.find((p: Phone) => p.primary)?.value ?? existing.phones?.[0]?.value ?? '',
      )
      setEmail(
        existing.emails?.find((e: Email) => e.primary)?.value ?? existing.emails?.[0]?.value ?? '',
      )
      setNotesMd(existing.notesMd ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, existing?.id])

  const onSave = async () => {
    const now = new Date().toISOString()
    // Build the contact by spreading any existing fields, then overwriting the
    // minimal editable set. exactOptionalPropertyTypes requires conditional spreading
    // for optional fields — we cannot assign `undefined` directly.
    const base: Contact = existing ?? {
      id: ulid(),
      createdAt: now,
      updatedAt: now,
      lamportTs: 0,
      deviceId: '',
    }
    const next: Contact = {
      ...base,
      id: base.id,
      createdAt: base.createdAt,
      updatedAt: now,
      lamportTs: base.lamportTs,
      deviceId: base.deviceId,
      ...(givenName.trim() ? { givenName: givenName.trim() } : {}),
      ...(familyName.trim() ? { familyName: familyName.trim() } : {}),
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      ...(phone.trim() ? { phones: [{ value: phone.trim(), primary: true }] } : {}),
      ...(email.trim() ? { emails: [{ value: email.trim(), primary: true }] } : {}),
      ...(notesMd.trim() ? { notesMd: notesMd.trim() } : {}),
    }
    await upsert(next)
    if (existing) {
      nav(`/contact/${existing.id}`)
    } else {
      nav('/list')
    }
  }

  const onCancel = () => {
    nav(-1)
  }

  return (
    <div className="h-full flex flex-col bg-slate-900">
      <header className="bg-slate-800 border-b border-slate-700 flex items-center px-2 py-2 gap-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="w-11 h-11 flex items-center justify-center text-slate-300 hover:bg-slate-700 rounded"
        >
          <X size={20} />
        </button>
        <h1 className="flex-1 text-base font-semibold text-slate-100">
          {mode === 'edit' ? 'Edit contact' : 'New contact'}
        </h1>
        <button
          type="button"
          onClick={() => void onSave()}
          aria-label="Save"
          className="px-4 h-11 rounded bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white text-sm font-medium"
        >
          Save
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <FormField label="First name" value={givenName} onChange={setGivenName} />
        <FormField label="Last name" value={familyName} onChange={setFamilyName} />
        <FormField label="Display name" value={displayName} onChange={setDisplayName} />
        <FormField label="Phone" value={phone} onChange={setPhone} type="tel" />
        <FormField label="Email" value={email} onChange={setEmail} type="email" />
        <FormFieldArea label="Notes" value={notesMd} onChange={setNotesMd} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function FormField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-400 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100 focus:outline-none focus:border-sky-500"
      />
    </label>
  )
}

function FormFieldArea({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-400 mb-1">{label}</span>
      <textarea
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-slate-100 resize-y focus:outline-none focus:border-sky-500"
      />
    </label>
  )
}
