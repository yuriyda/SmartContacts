/**
 * @file ContactEditDialog.tsx
 * Full-featured modal edit form for creating or editing a Contact.
 *
 * Rules:
 *  - Render null when open===false.
 *  - Esc cancels; Cmd/Ctrl+Enter saves; plain Enter does NOT submit.
 *  - Validation is warn-only (red border + hint text); never blocks Save.
 *  - No DB access — all mutations delegated to onSave callback in parent.
 *  - defs is read-only here; Settings dialog handles defs CRUD in T12.
 *  - SocialDetected, relationsExternal (Google passthrough) shown read-only.
 *  - No `any` types.
 */
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import type {
  Contact,
  CustomFieldDef,
  GoogleSyncRuntime,
  Phone,
  Email,
  PostalAddress,
  CalendarEvent,
  Organization,
  Url,
  ImClient,
  ExternalRelation,
  InternalRelation,
  GroupMembership,
  Reminder,
} from '@smart-contacts/shared'
import { computeDisplayName, ulid } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { ContactAvatar } from './ContactAvatar'
import { useContactAvatar } from './useContactAvatar'
import { AvatarLightbox } from './AvatarLightbox'
import { TagPill, GroupBadge } from './badges'
import { X, Plus } from './icons'

// ---------------------------------------------------------------------------
// Regexes for warn-only validation
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[\d\s\-(]{6,}$/

// ---------------------------------------------------------------------------
// Component contract
// ---------------------------------------------------------------------------

export interface ContactEditDialogProps {
  open: boolean
  contact: Contact | null
  defs: CustomFieldDef[]
  allContacts: Contact[]
  onSave: (c: Contact) => void
  onCancel: () => void
  /** Optional Google sync runtime — enables lazy on-demand avatar fetch + lightbox. */
  googleSync?: GoogleSyncRuntime | null
}

// ---------------------------------------------------------------------------
// Small reusable helpers
// ---------------------------------------------------------------------------

/** Section wrapper with a small heading. */
function FormSection({ title, children }: { title: string; children: ReactNode }) {
  const { TC } = useApp()
  return (
    <div className="space-y-2">
      <h3 className={`text-xs font-semibold uppercase tracking-wider ${TC.textMuted}`}>{title}</h3>
      {children}
    </div>
  )
}

/** Single text input with a label. */
function TextField({
  label,
  name,
  value,
  onChange,
  type = 'text',
  className,
}: {
  label: string
  name: string
  value: string
  onChange: (v: string) => void
  type?: string
  className?: string
}) {
  const { TC } = useApp()
  return (
    <div className={className}>
      <label className={`block text-xs mb-0.5 ${TC.textMuted}`} htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full text-sm rounded px-2.5 py-1.5 border outline-none focus:ring-1 focus:ring-sky-500 ${TC.input} ${TC.inputText} ${TC.text}`}
        autoComplete="off"
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          // Prevent plain Enter from submitting the form
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
          }
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// MultiInput generic
// ---------------------------------------------------------------------------

interface MultiInputProps<T> {
  label: string
  values: T[]
  onChange: (next: T[]) => void
  emptyValue: () => T
  renderRow: (item: T, update: (next: T) => void, remove: () => void) => ReactNode
}

function MultiInput<T>({ label, values, onChange, emptyValue, renderRow }: MultiInputProps<T>) {
  const { TC } = useApp()
  const add = () => onChange([...values, emptyValue()])
  const update = (i: number, next: T) => onChange(values.map((v, idx) => (idx === i ? next : v)))
  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-1.5">
      <span className={`text-xs ${TC.textMuted}`}>{label}</span>
      {values.map((item, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0">
            {renderRow(
              item,
              (next) => update(i, next),
              () => remove(i),
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className={`flex items-center gap-1 text-xs ${TC.textMuted} hover:${TC.textSec} transition-colors`}
      >
        <Plus size={12} />
        {label}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row renderers for each multi-input type
// ---------------------------------------------------------------------------

function inputCls(TC: { input: string; inputText: string; text: string }) {
  return `text-sm rounded px-2 py-1 border outline-none focus:ring-1 focus:ring-sky-500 ${TC.input} ${TC.inputText} ${TC.text}`
}

function selectCls(TC: { input: string; inputText: string; text: string }) {
  return `text-sm rounded px-2 py-1 border outline-none focus:ring-1 focus:ring-sky-500 ${TC.input} ${TC.inputText} ${TC.text}`
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  const { TC } = useApp()
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 ${TC.textMuted} hover:text-red-400 transition-colors mt-1.5`}
    >
      <X size={13} />
    </button>
  )
}

function PhoneRow({
  item,
  update,
  remove,
  allPhones,
  myIndex,
  updateAll,
}: {
  item: Phone
  update: (next: Phone) => void
  remove: () => void
  allPhones: Phone[]
  myIndex: number
  updateAll: (phones: Phone[]) => void
}) {
  const { TC, t } = useApp()
  const cls = inputCls(TC)
  const isInvalid = item.value.trim() && !PHONE_RE.test(item.value)

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <input
          type="tel"
          value={item.value}
          onChange={(e) => update({ ...item, value: e.target.value })}
          placeholder="+7 999 000 00 00"
          className={`${cls} flex-1 ${isInvalid ? 'border-red-500' : ''}`}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
          }}
        />
        <select
          value={item.type ?? ''}
          onChange={(e) => update({ ...item, type: e.target.value })}
          className={`${selectCls(TC)} w-24`}
        >
          <option value="">—</option>
          <option value="mobile">mobile</option>
          <option value="home">home</option>
          <option value="work">work</option>
          <option value="other">other</option>
        </select>
        {/* Primary radio: clicking makes this row primary, resets others */}
        <label className={`flex items-center gap-0.5 text-xs cursor-pointer ${TC.textMuted}`}>
          <input
            type="radio"
            checked={!!item.primary}
            onChange={() => {
              const next = allPhones.map((p, i) => ({ ...p, primary: i === myIndex }))
              updateAll(next)
            }}
          />
          ★
        </label>
        <RemoveButton onClick={remove} />
      </div>
      {isInvalid && <p className="text-xs text-red-400 pl-1">{t('validation.invalid_phone')}</p>}
    </div>
  )
}

function EmailRow({
  item,
  update,
  remove,
  allEmails,
  myIndex,
  updateAll,
}: {
  item: Email
  update: (next: Email) => void
  remove: () => void
  allEmails: Email[]
  myIndex: number
  updateAll: (emails: Email[]) => void
}) {
  const { TC, t } = useApp()
  const cls = inputCls(TC)
  const isInvalid = item.value.trim() && !EMAIL_RE.test(item.value)

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <input
          type="email"
          value={item.value}
          onChange={(e) => update({ ...item, value: e.target.value })}
          placeholder="user@example.com"
          className={`${cls} flex-1 ${isInvalid ? 'border-red-500' : ''}`}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
          }}
        />
        <select
          value={item.type ?? ''}
          onChange={(e) => update({ ...item, type: e.target.value })}
          className={`${selectCls(TC)} w-24`}
        >
          <option value="">—</option>
          <option value="home">home</option>
          <option value="work">work</option>
          <option value="other">other</option>
        </select>
        <label className={`flex items-center gap-0.5 text-xs cursor-pointer ${TC.textMuted}`}>
          <input
            type="radio"
            checked={!!item.primary}
            onChange={() => {
              const next = allEmails.map((em, i) => ({ ...em, primary: i === myIndex }))
              updateAll(next)
            }}
          />
          ★
        </label>
        <RemoveButton onClick={remove} />
      </div>
      {isInvalid && <p className="text-xs text-red-400 pl-1">{t('validation.invalid_email')}</p>}
    </div>
  )
}

function UrlRow({
  item,
  update,
  remove,
}: {
  item: Url
  update: (v: Url) => void
  remove: () => void
}) {
  const { TC } = useApp()
  const cls = inputCls(TC)
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="url"
        value={item.value}
        onChange={(e) => update({ ...item, value: e.target.value })}
        placeholder="https://…"
        className={`${cls} flex-1`}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
        }}
      />
      <input
        type="text"
        value={item.type ?? ''}
        onChange={(e) => update({ ...item, type: e.target.value })}
        placeholder="type"
        className={`${cls} w-24`}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
        }}
      />
      <RemoveButton onClick={remove} />
    </div>
  )
}

function AddressRow({
  item,
  update,
  remove,
}: {
  item: PostalAddress
  update: (v: PostalAddress) => void
  remove: () => void
}) {
  const { TC } = useApp()
  const cls = inputCls(TC)
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-1.5">
        <input
          type="text"
          value={item.street ?? ''}
          onChange={(e) => update({ ...item, street: e.target.value })}
          placeholder="Street"
          className={`${cls} col-span-2`}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
          }}
        />
        <input
          type="text"
          value={item.city ?? ''}
          onChange={(e) => update({ ...item, city: e.target.value })}
          placeholder="City"
          className={cls}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
          }}
        />
        <input
          type="text"
          value={item.region ?? ''}
          onChange={(e) => update({ ...item, region: e.target.value })}
          placeholder="Region"
          className={cls}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
          }}
        />
        <input
          type="text"
          value={item.postal ?? ''}
          onChange={(e) => update({ ...item, postal: e.target.value })}
          placeholder="Postal"
          className={cls}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
          }}
        />
        <input
          type="text"
          value={item.country ?? ''}
          onChange={(e) => update({ ...item, country: e.target.value })}
          placeholder="Country"
          className={cls}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
          }}
        />
        <input
          type="text"
          value={item.type ?? ''}
          onChange={(e) => update({ ...item, type: e.target.value })}
          placeholder="Type"
          className={cls}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
          }}
        />
        <div className="flex justify-end">
          <RemoveButton onClick={remove} />
        </div>
      </div>
    </div>
  )
}

function EventRow({
  item,
  update,
  remove,
}: {
  item: CalendarEvent
  update: (v: CalendarEvent) => void
  remove: () => void
}) {
  const { TC } = useApp()
  const cls = inputCls(TC)
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        value={item.date ?? ''}
        onChange={(e) => update({ ...item, date: e.target.value })}
        className={`${cls} flex-1`}
      />
      <select
        value={item.type}
        onChange={(e) => update({ ...item, type: e.target.value as CalendarEvent['type'] })}
        className={`${selectCls(TC)} w-28`}
      >
        <option value="birthday">birthday</option>
        <option value="anniversary">anniversary</option>
        <option value="custom">custom</option>
      </select>
      <RemoveButton onClick={remove} />
    </div>
  )
}

function OrgRow({
  item,
  update,
  remove,
}: {
  item: Organization
  update: (v: Organization) => void
  remove: () => void
}) {
  const { TC } = useApp()
  const cls = inputCls(TC)
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-1.5">
        <input
          type="text"
          value={item.name ?? ''}
          onChange={(e) => update({ ...item, name: e.target.value })}
          placeholder="Name"
          className={cls}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
          }}
        />
        <input
          type="text"
          value={item.title ?? ''}
          onChange={(e) => update({ ...item, title: e.target.value })}
          placeholder="Title / Role"
          className={cls}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
          }}
        />
        <input
          type="text"
          value={item.department ?? ''}
          onChange={(e) => update({ ...item, department: e.target.value })}
          placeholder="Department"
          className={cls}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
          }}
        />
        <div className="flex items-center gap-1.5">
          <label className={`text-xs ${TC.textMuted} flex items-center gap-1 cursor-pointer`}>
            <input
              type="checkbox"
              checked={!!item.current}
              onChange={(e) => {
                const current = e.target.checked
                update({ ...item, current, endDate: current ? null : (item.endDate ?? null) })
              }}
            />
            Current
          </label>
        </div>
        <div>
          <label className={`block text-xs ${TC.textMuted} mb-0.5`}>Start</label>
          <input
            type="date"
            value={item.startDate ?? ''}
            onChange={(e) => update({ ...item, startDate: e.target.value || null })}
            className={cls}
          />
        </div>
        <div>
          <label className={`block text-xs ${TC.textMuted} mb-0.5`}>End</label>
          <input
            type="date"
            value={item.endDate ?? ''}
            onChange={(e) => update({ ...item, endDate: e.target.value || null })}
            disabled={!!item.current}
            className={`${cls} disabled:opacity-40`}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <RemoveButton onClick={remove} />
      </div>
    </div>
  )
}

function ImRow({
  item,
  update,
  remove,
}: {
  item: ImClient
  update: (v: ImClient) => void
  remove: () => void
}) {
  const { TC } = useApp()
  const cls = inputCls(TC)
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={item.protocol}
        onChange={(e) => update({ ...item, protocol: e.target.value })}
        className={`${selectCls(TC)} w-32`}
      >
        <option value="telegram">telegram</option>
        <option value="signal">signal</option>
        <option value="whatsapp">whatsapp</option>
        <option value="other">other</option>
      </select>
      <input
        type="text"
        value={item.handle}
        onChange={(e) => update({ ...item, handle: e.target.value })}
        placeholder="@handle"
        className={`${cls} flex-1`}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
        }}
      />
      <RemoveButton onClick={remove} />
    </div>
  )
}

function ExtRelRow({
  item,
  update,
  remove,
}: {
  item: ExternalRelation
  update: (v: ExternalRelation) => void
  remove: () => void
}) {
  const { TC } = useApp()
  const cls = inputCls(TC)
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={item.person}
        onChange={(e) => update({ ...item, person: e.target.value })}
        placeholder="Person name"
        className={`${cls} flex-1`}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
        }}
      />
      <input
        type="text"
        value={item.type ?? ''}
        onChange={(e) => update({ ...item, type: e.target.value })}
        placeholder="Type (e.g. friend)"
        className={`${cls} w-28`}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
        }}
      />
      <RemoveButton onClick={remove} />
    </div>
  )
}

function ReminderRow({
  item,
  update,
  remove,
}: {
  item: Reminder
  update: (v: Reminder) => void
  remove: () => void
}) {
  const { TC } = useApp()
  const cls = inputCls(TC)
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        value={item.date ?? ''}
        onChange={(e) => update({ ...item, date: e.target.value })}
        className={`${cls} w-36`}
      />
      <input
        type="text"
        value={item.text}
        onChange={(e) => update({ ...item, text: e.target.value })}
        placeholder="Reminder text"
        className={`${cls} flex-1`}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
        }}
      />
      <label className={`flex items-center gap-1 text-xs cursor-pointer ${TC.textMuted}`}>
        <input
          type="checkbox"
          checked={!!item.done}
          onChange={(e) => update({ ...item, done: e.target.checked })}
        />
        done
      </label>
      <RemoveButton onClick={remove} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ContactPicker combobox for relationsInternal
// ---------------------------------------------------------------------------

function ContactPicker({
  allContacts,
  excludeIds,
  onSelect,
}: {
  allContacts: Contact[]
  excludeIds: Set<string>
  onSelect: (c: Contact) => void
}) {
  const { TC } = useApp()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [highlighted, setHighlighted] = useState(0)

  const filtered = allContacts
    .filter((c) => !excludeIds.has(c.id))
    .filter((c) => computeDisplayName(c, 'en').toLowerCase().includes(query.toLowerCase()))
    .slice(0, 20)

  const commit = useCallback(
    (c: Contact) => {
      onSelect(c)
      setQuery('')
      setOpen(false)
      setHighlighted(0)
    },
    [onSelect],
  )

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[highlighted]) commit(filtered[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          setQuery(e.target.value)
          setOpen(true)
          setHighlighted(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKey}
        placeholder="Add contact relation…"
        className={`w-full text-sm rounded px-2.5 py-1.5 border outline-none focus:ring-1 focus:ring-sky-500 ${TC.input} ${TC.inputText} ${TC.text}`}
      />
      {open && filtered.length > 0 && (
        <ul
          className={`absolute z-50 left-0 right-0 mt-0.5 max-h-48 overflow-y-auto rounded border shadow-xl ${TC.surface} ${TC.borderClass}`}
        >
          {filtered.map((c, i) => (
            <li
              key={c.id}
              onMouseDown={() => commit(c)}
              className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer text-sm ${TC.text} ${
                i === highlighted ? TC.elevated : TC.hoverBg
              }`}
            >
              <ContactAvatar id={c.id} name={computeDisplayName(c, 'en')} size={16} />
              {computeDisplayName(c, 'en')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// IntRelRow: single internal relation row
// ---------------------------------------------------------------------------

function IntRelRow({
  item,
  update,
  remove,
  allContacts,
}: {
  item: InternalRelation
  update: (v: InternalRelation) => void
  remove: () => void
  allContacts: Contact[]
}) {
  const { TC } = useApp()
  const cls = inputCls(TC)
  const linked = allContacts.find((c) => c.id === item.contactId)
  const name = linked ? computeDisplayName(linked, 'en') : item.contactId

  return (
    <div className="flex items-center gap-1.5">
      <ContactAvatar id={item.contactId} name={name} size={20} />
      <span className={`text-sm flex-1 truncate ${TC.text}`}>{name}</span>
      <input
        type="text"
        value={item.type ?? ''}
        onChange={(e) => update({ ...item, type: e.target.value })}
        placeholder="Relation type"
        className={`${cls} w-28`}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
        }}
      />
      <RemoveButton onClick={remove} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// GroupsInput: combobox with multi-value chips
// ---------------------------------------------------------------------------

function GroupsInput({
  value,
  onChange,
  allContacts,
}: {
  value: GroupMembership[]
  onChange: (next: GroupMembership[]) => void
  allContacts: Contact[]
}) {
  const { TC } = useApp()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  // Collect distinct group names across all contacts
  const allGroupNames = Array.from(
    new Set(allContacts.flatMap((c) => (c.groups ?? []).map((g) => g.name ?? g.id))),
  )

  const filtered = allGroupNames
    .filter((n) => n.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 20)

  const addGroup = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (value.some((g) => (g.name ?? g.id) === trimmed)) return
    onChange([...value, { id: ulid(), name: trimmed }])
    setQuery('')
    setOpen(false)
  }

  const removeGroup = (id: string) => onChange(value.filter((g) => g.id !== id))

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {value.map((g) => (
          <span key={g.id} className="inline-flex items-center gap-1">
            <GroupBadge id={g.id} name={g.name ?? g.id} />
            <button
              type="button"
              onClick={() => removeGroup(g.id)}
              className={`text-xs ${TC.textMuted} hover:text-red-400`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if ((e.key === 'Enter' || e.key === ',') && query.trim()) {
              e.preventDefault()
              addGroup(query)
            }
          }}
          placeholder="Add group…"
          className={`w-full text-sm rounded px-2.5 py-1.5 border outline-none focus:ring-1 focus:ring-sky-500 ${TC.input} ${TC.inputText} ${TC.text}`}
        />
        {open && (filtered.length > 0 || query.trim()) && (
          <ul
            className={`absolute z-50 left-0 right-0 mt-0.5 max-h-48 overflow-y-auto rounded border shadow-xl ${TC.surface} ${TC.borderClass}`}
          >
            {query.trim() && !filtered.includes(query.trim()) && (
              <li
                onMouseDown={() => addGroup(query)}
                className={`px-2.5 py-1.5 cursor-pointer text-sm ${TC.text} ${TC.hoverBg} italic`}
              >
                Add &quot;{query}&quot;
              </li>
            )}
            {filtered.map((n) => (
              <li
                key={n}
                onMouseDown={() => addGroup(n)}
                className={`px-2.5 py-1.5 cursor-pointer text-sm ${TC.text} ${TC.hoverBg}`}
              >
                {n}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TagsInput: comma/Enter-separated, render as TagPill with ×
// ---------------------------------------------------------------------------

function TagsInput({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const { TC } = useApp()
  const [input, setInput] = useState('')

  const addTag = (raw: string) => {
    raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((tag) => {
        if (!value.includes(tag)) onChange([...value, tag])
      })
    setInput('')
  }

  const removeTag = (tag: string) => onChange(value.filter((t) => t !== tag))

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-0.5">
            <TagPill name={tag} />
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className={`text-xs ${TC.textMuted} hover:text-red-400`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
            e.preventDefault()
            addTag(input)
          }
        }}
        onBlur={() => {
          if (input.trim()) addTag(input)
        }}
        placeholder="tag1, tag2, …"
        className={`w-full text-sm rounded px-2.5 py-1.5 border outline-none focus:ring-1 focus:ring-sky-500 ${TC.input} ${TC.inputText} ${TC.text}`}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function freshContact(): Contact {
  return {
    id: ulid(),
    createdAt: '',
    updatedAt: '',
    lamportTs: 0,
    deviceId: '',
    priority: 5,
  }
}

export function ContactEditDialog({
  open,
  contact,
  defs,
  allContacts,
  onSave,
  onCancel,
  googleSync = null,
}: ContactEditDialogProps) {
  const { TC, t, locale } = useApp()

  // Form state — initialised from contact (or fresh) when dialog opens
  const [form, setForm] = useState<Contact>(() =>
    contact ? structuredClone(contact) : freshContact(),
  )

  // Lazy on-demand avatar (also fires when user opens the dialog for a Google
  // contact whose photo hasn't been cached yet via ContactDetail).
  const photoDataUrl = useContactAvatar(googleSync, contact?.id, contact?.googleResourceName)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // Re-sync when dialog re-opens or the contact prop changes
  useEffect(() => {
    if (open) {
      setForm(contact ? structuredClone(contact) : freshContact())
    }
  }, [open, contact])

  // Generic field setter
  const setField = useCallback(<K extends keyof Contact>(key: K, value: Contact[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Save handler: compute displayName fallback, then delegate to parent
  const handleSave = useCallback(() => {
    const next = { ...form }
    if (!next.displayName?.trim()) {
      next.displayName = computeDisplayName(next, locale)
    }
    onSave(next)
  }, [form, locale, onSave])

  // Keyboard handler on the panel
  const handlePanelKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        handleSave()
      }
    },
    [onCancel, handleSave],
  )

  if (!open) return null

  const isNew = !contact
  const inCls = `w-full text-sm rounded px-2.5 py-1.5 border outline-none focus:ring-1 focus:ring-sky-500 ${TC.input} ${TC.inputText} ${TC.text}`

  // IDs already in relationsInternal + self — to exclude from ContactPicker
  const excludedFromPicker = new Set<string>([
    form.id,
    ...(form.relationsInternal ?? []).map((r) => r.contactId),
  ])

  // Helpers to update list fields
  const phones = form.phones ?? []
  const emails = form.emails ?? []
  const urls = form.urls ?? []
  const addresses = form.addresses ?? []
  const events = form.events ?? []
  const orgs = form.organizations ?? []
  const imClients = form.imClients ?? []
  const extRels = form.relationsExternal ?? []
  const intRels = form.relationsInternal ?? []
  const tags = form.tags ?? []
  const groups = form.groups ?? []
  const reminders = form.reminders ?? []
  const customFields = form.customFields ?? {}

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className={`${TC.surface} ${TC.text} w-full max-w-3xl max-h-[90vh] flex flex-col rounded-lg shadow-2xl border ${TC.borderClass}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handlePanelKeyDown}
      >
        {/* ── Header ── */}
        <div className={`flex items-center justify-between px-5 py-3 border-b ${TC.borderClass}`}>
          <h2 className={`text-base font-semibold ${TC.text}`}>
            {isNew ? t('actions.add') : t('actions.edit')}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className={`p-1 rounded hover:opacity-70 ${TC.textMuted}`}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Avatar preview — only meaningful when the contact has bytes cached. */}
          {!isNew && (
            <div className="flex items-center gap-3">
              <ContactAvatar
                id={form.id}
                name={computeDisplayName(form, locale)}
                size={72}
                photoDataUrl={photoDataUrl}
                onPhotoClick={photoDataUrl ? () => setLightboxOpen(true) : undefined}
              />
              {photoDataUrl !== null && (
                <p className={`text-xs ${TC.textMuted}`}>
                  {t('actions.click_photo_to_zoom') || 'Click photo to view full size'}
                </p>
              )}
            </div>
          )}

          {/* 1. Names */}
          <FormSection title={t('field.display_name')}>
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label={t('field.display_name')}
                name="displayName"
                value={form.displayName ?? ''}
                onChange={(v) => setField('displayName', v)}
                className="col-span-2"
              />
              <TextField
                label={t('field.given_name')}
                name="givenName"
                value={form.givenName ?? ''}
                onChange={(v) => setField('givenName', v)}
              />
              <TextField
                label={t('field.family_name')}
                name="familyName"
                value={form.familyName ?? ''}
                onChange={(v) => setField('familyName', v)}
              />
              <TextField
                label={t('field.middle_name')}
                name="middleName"
                value={form.middleName ?? ''}
                onChange={(v) => setField('middleName', v)}
                className="col-span-2"
              />
              <TextField
                label={t('field.honorific_prefix')}
                name="honorificPrefix"
                value={form.honorificPrefix ?? ''}
                onChange={(v) => setField('honorificPrefix', v)}
              />
              <TextField
                label={t('field.honorific_suffix')}
                name="honorificSuffix"
                value={form.honorificSuffix ?? ''}
                onChange={(v) => setField('honorificSuffix', v)}
              />
              <TextField
                label={t('field.phonetic_given')}
                name="phoneticGiven"
                value={form.phoneticGiven ?? ''}
                onChange={(v) => setField('phoneticGiven', v)}
              />
              <TextField
                label={t('field.phonetic_family')}
                name="phoneticFamily"
                value={form.phoneticFamily ?? ''}
                onChange={(v) => setField('phoneticFamily', v)}
              />
              <TextField
                label={t('field.nickname')}
                name="nickname"
                value={form.nickname ?? ''}
                onChange={(v) => setField('nickname', v)}
              />
              <TextField
                label={t('field.locale')}
                name="locale"
                value={form.locale ?? ''}
                onChange={(v) => setField('locale', v)}
              />
              <TextField
                label={t('field.gender')}
                name="gender"
                value={form.gender ?? ''}
                onChange={(v) => setField('gender', v)}
              />
              <TextField
                label={t('field.occupation')}
                name="occupation"
                value={form.occupation ?? ''}
                onChange={(v) => setField('occupation', v)}
              />
            </div>
          </FormSection>

          {/* 2. Phones */}
          <FormSection title={t('field.phones')}>
            <MultiInput<Phone>
              label={t('field.phones')}
              values={phones}
              onChange={(v) => setField('phones', v)}
              emptyValue={() => ({ value: '', type: 'mobile' })}
              renderRow={(item, update, remove) => {
                const idx = phones.indexOf(item)
                return (
                  <PhoneRow
                    item={item}
                    update={update}
                    remove={remove}
                    allPhones={phones}
                    myIndex={idx}
                    updateAll={(v) => setField('phones', v)}
                  />
                )
              }}
            />
          </FormSection>

          {/* 2b. Emails */}
          <FormSection title={t('field.emails')}>
            <MultiInput<Email>
              label={t('field.emails')}
              values={emails}
              onChange={(v) => setField('emails', v)}
              emptyValue={() => ({ value: '', type: 'home' })}
              renderRow={(item, update, remove) => {
                const idx = emails.indexOf(item)
                return (
                  <EmailRow
                    item={item}
                    update={update}
                    remove={remove}
                    allEmails={emails}
                    myIndex={idx}
                    updateAll={(v) => setField('emails', v)}
                  />
                )
              }}
            />
          </FormSection>

          {/* 2c. URLs */}
          <FormSection title={t('field.urls')}>
            <MultiInput<Url>
              label={t('field.urls')}
              values={urls}
              onChange={(v) => setField('urls', v)}
              emptyValue={() => ({ value: '' })}
              renderRow={(item, update, remove) => (
                <UrlRow item={item} update={update} remove={remove} />
              )}
            />
          </FormSection>

          {/* 3. Addresses */}
          <FormSection title={t('field.addresses')}>
            <MultiInput<PostalAddress>
              label={t('field.addresses')}
              values={addresses}
              onChange={(v) => setField('addresses', v)}
              emptyValue={() => ({})}
              renderRow={(item, update, remove) => (
                <AddressRow item={item} update={update} remove={remove} />
              )}
            />
          </FormSection>

          {/* 4. Events */}
          <FormSection title={t('field.events')}>
            <MultiInput<CalendarEvent>
              label={t('field.events')}
              values={events}
              onChange={(v) => setField('events', v)}
              emptyValue={() => ({ date: '', type: 'birthday' })}
              renderRow={(item, update, remove) => (
                <EventRow item={item} update={update} remove={remove} />
              )}
            />
          </FormSection>

          {/* 5. Organizations */}
          <FormSection title={t('field.organizations')}>
            <MultiInput<Organization>
              label={t('field.organizations')}
              values={orgs}
              onChange={(v) => setField('organizations', v)}
              emptyValue={() => ({ name: '', current: true })}
              renderRow={(item, update, remove) => (
                <OrgRow item={item} update={update} remove={remove} />
              )}
            />
          </FormSection>

          {/* 6. IM Clients */}
          <FormSection title={t('field.im_clients')}>
            <MultiInput<ImClient>
              label={t('field.im_clients')}
              values={imClients}
              onChange={(v) => setField('imClients', v)}
              emptyValue={() => ({ protocol: 'telegram', handle: '' })}
              renderRow={(item, update, remove) => (
                <ImRow item={item} update={update} remove={remove} />
              )}
            />
          </FormSection>

          {/* 7. External relations */}
          <FormSection title={t('field.relations_external')}>
            <MultiInput<ExternalRelation>
              label={t('field.relations_external')}
              values={extRels}
              onChange={(v) => setField('relationsExternal', v)}
              emptyValue={() => ({ person: '' })}
              renderRow={(item, update, remove) => (
                <ExtRelRow item={item} update={update} remove={remove} />
              )}
            />
          </FormSection>

          {/* 8. Internal relations */}
          <FormSection title={t('field.relations')}>
            <div className="space-y-1.5">
              {intRels.map((rel, i) => (
                <IntRelRow
                  key={rel.contactId + i}
                  item={rel}
                  update={(next) =>
                    setField(
                      'relationsInternal',
                      intRels.map((r, idx) => (idx === i ? next : r)),
                    )
                  }
                  remove={() =>
                    setField(
                      'relationsInternal',
                      intRels.filter((_, idx) => idx !== i),
                    )
                  }
                  allContacts={allContacts}
                />
              ))}
              <ContactPicker
                allContacts={allContacts}
                excludeIds={excludedFromPicker}
                onSelect={(c) => setField('relationsInternal', [...intRels, { contactId: c.id }])}
              />
            </div>
          </FormSection>

          {/* 9. Tags */}
          <FormSection title={t('field.tags')}>
            <TagsInput value={tags} onChange={(v) => setField('tags', v)} />
          </FormSection>

          {/* 10. Groups */}
          <FormSection title={t('field.groups')}>
            <GroupsInput
              value={groups}
              onChange={(v) => setField('groups', v)}
              allContacts={allContacts}
            />
          </FormSection>

          {/* 11. Notes */}
          <FormSection title={t('field.notes')}>
            <textarea
              value={form.notesMd ?? ''}
              onChange={(e) => setField('notesMd', e.target.value)}
              placeholder="Markdown notes…"
              className={`w-full text-sm rounded px-2.5 py-1.5 border outline-none focus:ring-1 focus:ring-sky-500 font-mono min-h-32 resize-y ${TC.input} ${TC.inputText} ${TC.text}`}
            />
          </FormSection>

          {/* 12. Custom fields */}
          {defs.filter((d) => !d.deletedAt).length > 0 && (
            <FormSection title={t('field.custom_fields')}>
              <div className="grid grid-cols-2 gap-3">
                {defs
                  .filter((d) => !d.deletedAt)
                  .map((def) => {
                    const val = customFields[def.id]
                    return (
                      <div key={def.id}>
                        <label className={`block text-xs mb-0.5 ${TC.textMuted}`}>{def.name}</label>
                        {def.type === 'boolean' ? (
                          <input
                            type="checkbox"
                            checked={!!val}
                            onChange={(e) =>
                              setField('customFields', {
                                ...customFields,
                                [def.id]: e.target.checked,
                              })
                            }
                            className="mt-1"
                          />
                        ) : def.type === 'select' ? (
                          <select
                            value={typeof val === 'string' ? val : ''}
                            onChange={(e) =>
                              setField('customFields', {
                                ...customFields,
                                [def.id]: e.target.value,
                              })
                            }
                            className={inCls}
                          >
                            <option value="">—</option>
                            {def.options.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={
                              def.type === 'date'
                                ? 'date'
                                : def.type === 'number'
                                  ? 'number'
                                  : def.type === 'url'
                                    ? 'url'
                                    : 'text'
                            }
                            value={val == null ? '' : String(val)}
                            onChange={(e) => {
                              const raw = e.target.value
                              const parsed: string | number | null =
                                def.type === 'number'
                                  ? raw === ''
                                    ? null
                                    : parseFloat(raw)
                                  : raw || null
                              setField('customFields', {
                                ...customFields,
                                [def.id]: parsed,
                              })
                            }}
                            className={inCls}
                            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault()
                            }}
                          />
                        )}
                      </div>
                    )
                  })}
              </div>
            </FormSection>
          )}

          {/* 13. Priority */}
          <FormSection title={t('field.priority')}>
            <div className="flex gap-1">
              {([1, 2, 3, 4, 5] as const).map((n) => {
                const active = form.priority === n
                const colorMap: Record<number, string> = {
                  1: 'border-red-500 text-red-500',
                  2: 'border-orange-500 text-orange-500',
                  3: 'border-sky-500 text-sky-500',
                  4: 'border-gray-400 text-gray-400',
                  5: 'border-gray-500 text-gray-500',
                }
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setField('priority', n)}
                    title={t(`priority.${n}`)}
                    className={`flex-1 py-1.5 rounded text-xs font-bold border transition-colors ${
                      active ? `${colorMap[n]} bg-opacity-20` : `${TC.borderClass} ${TC.textMuted}`
                    } ${active ? 'opacity-100' : 'opacity-50'}`}
                  >
                    {n}
                  </button>
                )
              })}
            </div>
          </FormSection>

          {/* 14. Preferred channel */}
          <FormSection title={t('field.preferred_channel')}>
            <select
              value={form.preferredChannel ?? ''}
              onChange={(e) => setField('preferredChannel', e.target.value || undefined)}
              className={inCls}
            >
              <option value="">—</option>
              <option value="phone">{t('channel.phone')}</option>
              <option value="email">{t('channel.email')}</option>
              <option value="telegram">{t('channel.telegram')}</option>
              <option value="signal">{t('channel.signal')}</option>
              <option value="whatsapp">{t('channel.whatsapp')}</option>
              <option value="other">{t('channel.other')}</option>
            </select>
          </FormSection>

          {/* 15. Reminders */}
          <FormSection title={t('field.reminders')}>
            <MultiInput<Reminder>
              label={t('field.reminders')}
              values={reminders}
              onChange={(v) => setField('reminders', v)}
              emptyValue={() => ({ id: ulid(), date: '', text: '', done: false })}
              renderRow={(item, update, remove) => (
                <ReminderRow item={item} update={update} remove={remove} />
              )}
            />
          </FormSection>

          {/* Read-only: SocialDetected */}
          {(form.socialDetected?.length ?? 0) > 0 && (
            <FormSection title={t('field.social')}>
              <p className={`text-xs ${TC.textMuted} italic mb-1`}>Managed by Google sync (P5)</p>
              {form.socialDetected!.map((s, i) => (
                <div key={i} className={`text-sm ${TC.textSec}`}>
                  {s.platform}: {s.handle}
                </div>
              ))}
            </FormSection>
          )}

          {/* Read-only: userDefined */}
          {form.userDefined && Object.keys(form.userDefined).length > 0 && (
            <FormSection title={t('field.user_defined')}>
              <p className={`text-xs ${TC.textMuted} italic mb-1`}>Managed by Google sync (P5)</p>
              {Object.entries(form.userDefined).map(([k, v]) => (
                <div key={k} className={`text-sm ${TC.textSec}`}>
                  {k}: {v}
                </div>
              ))}
            </FormSection>
          )}
        </div>

        {/* ── Footer ── */}
        <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${TC.borderClass}`}>
          <button
            type="button"
            onClick={onCancel}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${TC.elevated} ${TC.textSec} hover:opacity-80`}
          >
            {t('actions.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors"
          >
            {t('actions.save')}
          </button>
        </div>
      </div>

      <AvatarLightbox
        open={lightboxOpen}
        src={photoDataUrl}
        alt={computeDisplayName(form, locale)}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  )
}
