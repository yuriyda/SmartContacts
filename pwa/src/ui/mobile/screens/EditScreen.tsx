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
 * Edit-mode correctness rules (P11.T4 follow-up):
 *  - Cleared fields are explicitly deleted from the draft so stale values are
 *    not retained from the base spread (Issue 1).
 *  - Secondary phones/emails on the existing contact are preserved; only the
 *    primary slot is overwritten (Issue 2).
 *  - Deleting a protected contact shows an upgraded confirm message (Issue 3).
 *
 * Note: window.confirm is used only on delete (protected guard). Cancel
 * navigates back immediately; unsaved-changes guard is deferred.
 *
 * Rules:
 *  - No DB access; all mutations via useContacts.upsert / softDelete.
 *  - lamportTs and deviceId are set to sentinel values (0 / '') — repo.upsert overwrites them.
 *  - exactOptionalPropertyTypes: never assign `undefined` to optional keys;
 *    use setOrDelete() or rewrite*Primary() helpers instead.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import type { Contact, Phone, Email } from '@smart-contacts/shared'
import { ulid } from '@smart-contacts/shared'
import type { DbState } from '@smart-contacts/web'
import { useContacts } from '@smart-contacts/web/store/useContacts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assign or delete a key on a Contact object.
 * Required because exactOptionalPropertyTypes forbids direct `obj.key = undefined`.
 */
function setOrDelete<K extends keyof Contact>(
  obj: Contact,
  key: K,
  value: Contact[K] | undefined,
): void {
  if (value === undefined) {
    delete (obj as unknown as Record<string, unknown>)[key as string]
  } else {
    obj[key] = value
  }
}

/**
 * Return an updated phones array where the primary slot is replaced with
 * newValue while secondary entries are preserved unchanged.
 * Returns undefined when the resulting list is empty.
 */
function rewritePrimaryPhone(existing: Contact | null, newValue: string): Phone[] | undefined {
  const list = (existing?.phones ?? []).slice()
  const primaryIdx = list.findIndex((p) => p.primary)
  const idx = primaryIdx >= 0 ? primaryIdx : 0
  const trimmed = newValue.trim()
  if (!trimmed) {
    if (list.length > idx) list.splice(idx, 1)
    return list.length > 0 ? list : undefined
  }
  if (list.length === 0) return [{ value: trimmed, primary: true }]
  list[idx] = { ...list[idx]!, value: trimmed, primary: true }
  // Ensure no other entry claims primary
  return list.map((p, i) => (i === idx ? p : { ...p, primary: false }))
}

/**
 * Return an updated emails array where the primary slot is replaced with
 * newValue while secondary entries are preserved unchanged.
 * Returns undefined when the resulting list is empty.
 */
function rewritePrimaryEmail(existing: Contact | null, newValue: string): Email[] | undefined {
  const list = (existing?.emails ?? []).slice()
  const primaryIdx = list.findIndex((e) => e.primary)
  const idx = primaryIdx >= 0 ? primaryIdx : 0
  const trimmed = newValue.trim()
  if (!trimmed) {
    if (list.length > idx) list.splice(idx, 1)
    return list.length > 0 ? list : undefined
  }
  if (list.length === 0) return [{ value: trimmed, primary: true }]
  list[idx] = { ...list[idx]!, value: trimmed, primary: true }
  // Ensure no other entry claims primary
  return list.map((e, i) => (i === idx ? e : { ...e, primary: false }))
}

interface Props {
  dbState: DbState
  mode: 'new' | 'edit'
}

export function EditScreen({ dbState, mode }: Props) {
  const { id } = useParams<{ id: string }>()
  const { contacts, upsert, softDelete } = useContacts(dbState.contactsRepo)
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
    // Start from existing contact (edit) or a fresh skeleton (new).
    const base: Contact = existing ?? {
      id: ulid(),
      createdAt: now,
      updatedAt: now,
      lamportTs: 0,
      deviceId: '',
    }

    // Build draft by spreading base, then explicitly set-or-delete each editable
    // field so that clearing a field in edit mode removes the old value instead
    // of silently retaining it from the base spread (Issue 1).
    const draft: Contact = { ...base }
    setOrDelete(draft, 'givenName', givenName.trim() || undefined)
    setOrDelete(draft, 'familyName', familyName.trim() || undefined)
    setOrDelete(draft, 'displayName', displayName.trim() || undefined)
    setOrDelete(draft, 'notesMd', notesMd.trim() || undefined)

    // Preserve secondary phones/emails from the existing contact; only the
    // primary slot is overwritten (Issue 2).
    setOrDelete(draft, 'phones', rewritePrimaryPhone(existing, phone))
    setOrDelete(draft, 'emails', rewritePrimaryEmail(existing, email))

    draft.updatedAt = now

    await upsert(draft)
    if (existing) {
      nav(`/contact/${existing.id}`)
    } else {
      nav('/list')
    }
  }

  const onDelete = async () => {
    if (!existing) return
    // Issue 3: show a stronger warning when the contact is protected.
    const confirmMsg = existing.protected
      ? 'This contact is protected. Delete anyway?'
      : 'Delete this contact?'
    if (!window.confirm(confirmMsg)) return
    await softDelete(existing.id)
    nav('/list')
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
        {mode === 'edit' && (existing?.phones?.length ?? 0) > 1 ? (
          <FormField
            label="Phone"
            value={phone}
            onChange={setPhone}
            type="tel"
            hint="Other phones are preserved."
          />
        ) : (
          <FormField label="Phone" value={phone} onChange={setPhone} type="tel" />
        )}
        {mode === 'edit' && (existing?.emails?.length ?? 0) > 1 ? (
          <FormField
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            hint="Other emails are preserved."
          />
        ) : (
          <FormField label="Email" value={email} onChange={setEmail} type="email" />
        )}
        <FormFieldArea label="Notes" value={notesMd} onChange={setNotesMd} />
        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => void onDelete()}
            className="w-full mt-4 h-11 rounded border border-red-500 text-red-400 hover:bg-red-900/30 text-sm font-medium"
          >
            Delete contact
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Internal UI helpers
// ---------------------------------------------------------------------------

function FormField({
  label,
  value,
  onChange,
  type = 'text',
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  hint?: string
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
      {hint && <span className="block text-xs text-slate-500 mt-0.5">{hint}</span>}
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
