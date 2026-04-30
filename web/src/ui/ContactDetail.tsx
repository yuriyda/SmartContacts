/**
 * @file ContactDetail.tsx
 * Right-pane read view for a single contact.
 * Mirrors the section grammar of TaskOrchestrator's DetailPanel.tsx.
 * Rules: no DB access; purely presentational. All data arrives via props.
 * Sections only render when they have data (except the header, which always renders).
 * Wikilinks in notes are rendered as React <button> elements (not dangerouslySetInnerHTML)
 * so that onClick handlers can be attached correctly.
 */
import { useState, type ReactNode } from 'react'
import type { Contact, CustomFieldDef } from '@smart-contacts/shared'
import { computeDisplayName, fmtDate } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { ContactAvatar } from './ContactAvatar'
import { TagPill, GroupBadge } from './badges'
import { EmptyState } from './common'
import {
  Users,
  ChevronRight,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Globe,
  MessageSquare,
  Heart,
  Bell,
  Star,
  Edit3,
  RotateCcw,
  Trash2,
  Clock,
} from './icons'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContactDetailProps {
  contact: Contact | null
  defs: CustomFieldDef[]
  allContacts: Contact[]
  onEdit?: () => void
  onTouch?: () => void
  onDelete?: () => void
  onRestore?: () => void
  onSelectContact?: (id: string) => void
  /** Panel width in px; driven by parent ResizeHandle state. */
  width?: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Escape HTML special characters to prevent XSS before injecting rendered markdown. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Render a plain-text markdown chunk (no wikilinks) to an HTML string.
 * Escapes HTML first, then substitutes markdown patterns.
 * Only safe because we escape before substituting — no raw user HTML leaks.
 */
function renderPlainMarkdownChunk(raw: string): string {
  let s = escapeHtml(raw)

  // ## heading → h3
  s = s.replace(/^## (.+)$/gm, '<h3 class="font-semibold mt-3 mb-1">$1</h3>')

  // bullet lines → collect into ul
  s = s.replace(/((?:^- .+\n?)+)/gm, (block) => {
    const items = block
      .trim()
      .split('\n')
      .map((line) => `<li>${line.replace(/^- /, '')}</li>`)
      .join('')
    return `<ul class="list-disc pl-5">${items}</ul>`
  })

  // **bold**
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // *italic*
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // [label](url)
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a target="_blank" rel="noopener" class="underline text-sky-400 hover:text-sky-300" href="$2">$1</a>',
  )

  return s
}

/** Slug for wikilink resolution: lowercase, spaces → hyphens, strip non-word chars. */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-а-яё]/gi, '')
}

// ---------------------------------------------------------------------------
// NotesMdRenderer
// ---------------------------------------------------------------------------

/**
 * Splits notes markdown on [[wikilinks]], renders plain segments via
 * dangerouslySetInnerHTML, and wikilink segments as <button> elements.
 */
function NotesMdRenderer({
  text,
  allContacts,
  onSelectContact,
}: {
  text: string
  allContacts: Contact[]
  onSelectContact?: (id: string) => void
}) {
  const { TC } = useApp()

  // Split on [[...]] — odd indices are wikilink targets, even are plain text
  const parts = text.split(/\[\[([^\]]+)\]\]/)
  const nodes: ReactNode[] = []

  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i]!
    if (i % 2 === 0) {
      // Plain markdown chunk
      if (chunk) {
        nodes.push(
          <span
            key={i}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: renderPlainMarkdownChunk(chunk) }}
          />,
        )
      }
    } else {
      // Wikilink target
      const wikiTarget = chunk
      const resolved = allContacts.find(
        (c) =>
          slug(computeDisplayName(c, 'en')) === wikiTarget ||
          slug(computeDisplayName(c, 'ru')) === wikiTarget,
      )
      if (resolved && onSelectContact) {
        nodes.push(
          <button
            key={i}
            onClick={() => onSelectContact(resolved.id)}
            className="text-sky-400 hover:text-sky-300 underline cursor-pointer"
          >
            {computeDisplayName(resolved, 'en')}
          </button>,
        )
      } else {
        nodes.push(
          <span key={i} className={TC.textMuted}>
            [[{wikiTarget}]]
          </span>,
        )
      }
    }
  }

  return <div className={`text-sm leading-relaxed ${TC.text} prose-sm`}>{nodes}</div>
}

// ---------------------------------------------------------------------------
// DetailSection
// ---------------------------------------------------------------------------

function DetailSection({
  label,
  defaultOpen = true,
  children,
}: {
  id: string
  label: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const { TC } = useApp()
  return (
    <div className={`px-4 py-3 border-b ${TC.borderClass}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center w-full mb-2 group">
        <ChevronRight
          size={12}
          className={`${TC.textMuted} mr-1 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <span className={`text-xs font-semibold uppercase tracking-wider ${TC.textMuted}`}>
          {label}
        </span>
      </button>
      {open && <div className={`text-sm ${TC.text}`}>{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// LabelValue helper row inside a section
// ---------------------------------------------------------------------------

function LVRow({ label, children }: { label: string; children: ReactNode }) {
  const { TC } = useApp()
  return (
    <div className="flex gap-2 py-0.5">
      <span className={`text-xs w-28 flex-shrink-0 ${TC.textMuted} mt-0.5`}>{label}</span>
      <span className={`text-sm flex-1 min-w-0 break-words ${TC.text}`}>{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ContactDetail({
  contact,
  defs,
  allContacts,
  onEdit,
  onTouch,
  onDelete,
  onRestore,
  onSelectContact,
  width = 420,
}: ContactDetailProps) {
  const { TC, t, locale } = useApp()

  // ── Empty state ──
  if (contact === null) {
    return (
      <aside
        className={`relative flex-shrink-0 border-l ${TC.borderClass} ${TC.aside} flex items-center justify-center`}
        style={{ width: `${width}px` }}
      >
        <EmptyState icon={Users} title={t('empty.select')} />
      </aside>
    )
  }

  const displayName = computeDisplayName(contact, locale)
  const primaryPhone = contact.phones?.find((p) => p.primary) ?? contact.phones?.[0]
  const primaryEmail = contact.emails?.find((e) => e.primary) ?? contact.emails?.[0]
  const isDeleted = !!contact.deletedAt

  // Short device prefix for display
  const devicePrefix = contact.deviceId?.slice(0, 4) ?? '????'

  // Format a date string to locale-friendly display
  const fmtLocalDate = (iso?: string | null) => {
    if (!iso) return '—'
    return fmtDate(iso, 'YYYY-MM-DD', locale)
  }

  // Timestamp string for createdAt / updatedAt
  const fmtTs = (iso: string) =>
    new Date(iso).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <aside
      className={`relative flex-shrink-0 border-l ${TC.borderClass} ${TC.aside} flex flex-col overflow-y-auto`}
      style={{ width: `${width}px` }}
    >
      {/* ── Deleted banner ── */}
      {isDeleted && (
        <div className="bg-red-900/60 border-b border-red-700/60 px-4 py-2 text-red-300 text-sm font-medium">
          {t('actions.delete')} — {t('sidebar.trash')}
        </div>
      )}

      {/* ── Header ── */}
      <div className={`px-4 py-4 border-b ${TC.borderClass}`}>
        {/* Avatar + name row */}
        <div className="flex items-start gap-3 mb-3">
          <ContactAvatar id={contact.id} name={displayName} size={64} />
          <div className="flex-1 min-w-0">
            <h2 className={`text-xl font-semibold leading-tight truncate ${TC.text}`}>
              {displayName}
            </h2>
            {contact.nickname && (
              <p className={`text-sm ${TC.textMuted} mt-0.5`}>&quot;{contact.nickname}&quot;</p>
            )}
            {primaryPhone && (
              <a
                href={`tel:${primaryPhone.value}`}
                className="flex items-center gap-1 text-sm text-sky-400 hover:text-sky-300 mt-1"
              >
                <Phone size={12} />
                {primaryPhone.value}
              </a>
            )}
            {primaryEmail && (
              <a
                href={`mailto:${primaryEmail.value}`}
                className="flex items-center gap-1 text-sm text-sky-400 hover:text-sky-300 mt-0.5"
              >
                <Mail size={12} />
                {primaryEmail.value}
              </a>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          {isDeleted ? (
            <button
              onClick={onRestore}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              <RotateCcw size={13} />
              {t('actions.restore')}
            </button>
          ) : (
            <>
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors"
              >
                <Edit3 size={13} />
                {t('actions.edit')}
              </button>
              <button
                onClick={onTouch}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${TC.elevated} ${TC.textSec} hover:opacity-80`}
              >
                <Clock size={13} />
                {t('actions.touch')}
              </button>
              <button
                onClick={onDelete}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${TC.elevated} text-red-400 hover:text-red-300 hover:opacity-80`}
              >
                <Trash2 size={13} />
                {t('actions.delete')}
              </button>
            </>
          )}
        </div>

        {/* ULID + lamport + device muted */}
        <p className={`text-[10px] ${TC.textMuted} mt-3 font-mono break-all`}>
          {contact.id} · L{contact.lamportTs} · dev:{devicePrefix}
        </p>
      </div>

      {/* ── Names section ── */}
      {(contact.givenName ||
        contact.familyName ||
        contact.middleName ||
        contact.honorificPrefix ||
        contact.honorificSuffix ||
        contact.phoneticGiven ||
        contact.phoneticFamily ||
        contact.locale ||
        contact.gender ||
        contact.occupation) && (
        <DetailSection id="names" label={t('field.display_name')} defaultOpen={false}>
          {contact.givenName && <LVRow label={t('field.given_name')}>{contact.givenName}</LVRow>}
          {contact.familyName && <LVRow label={t('field.family_name')}>{contact.familyName}</LVRow>}
          {contact.middleName && <LVRow label={t('field.middle_name')}>{contact.middleName}</LVRow>}
          {contact.honorificPrefix && (
            <LVRow label={t('field.honorific_prefix')}>{contact.honorificPrefix}</LVRow>
          )}
          {contact.honorificSuffix && (
            <LVRow label={t('field.honorific_suffix')}>{contact.honorificSuffix}</LVRow>
          )}
          {contact.phoneticGiven && (
            <LVRow label={t('field.phonetic_given')}>{contact.phoneticGiven}</LVRow>
          )}
          {contact.phoneticFamily && (
            <LVRow label={t('field.phonetic_family')}>{contact.phoneticFamily}</LVRow>
          )}
          {contact.locale && <LVRow label={t('field.locale')}>{contact.locale}</LVRow>}
          {contact.gender && <LVRow label={t('field.gender')}>{contact.gender}</LVRow>}
          {contact.occupation && <LVRow label={t('field.occupation')}>{contact.occupation}</LVRow>}
        </DetailSection>
      )}

      {/* ── Phones ── */}
      {(contact.phones?.length ?? 0) > 0 && (
        <DetailSection id="phones" label={t('field.phones')}>
          {contact.phones!.map((ph, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <Phone size={12} className={TC.textMuted} />
              {ph.primary && <Star size={10} className="text-yellow-400 flex-shrink-0" />}
              <span className={`text-xs w-16 flex-shrink-0 ${TC.textMuted}`}>{ph.type ?? ''}</span>
              <a href={`tel:${ph.value}`} className="text-sm text-sky-400 hover:text-sky-300">
                {ph.value}
              </a>
            </div>
          ))}
        </DetailSection>
      )}

      {/* ── Emails ── */}
      {(contact.emails?.length ?? 0) > 0 && (
        <DetailSection id="emails" label={t('field.emails')}>
          {contact.emails!.map((em, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <Mail size={12} className={TC.textMuted} />
              {em.primary && <Star size={10} className="text-yellow-400 flex-shrink-0" />}
              <span className={`text-xs w-16 flex-shrink-0 ${TC.textMuted}`}>{em.type ?? ''}</span>
              <a
                href={`mailto:${em.value}`}
                className="text-sm text-sky-400 hover:text-sky-300 truncate"
              >
                {em.value}
              </a>
            </div>
          ))}
        </DetailSection>
      )}

      {/* ── Addresses ── */}
      {(contact.addresses?.length ?? 0) > 0 && (
        <DetailSection id="addresses" label={t('field.addresses')}>
          {contact.addresses!.map((addr, i) => (
            <div key={i} className="py-1">
              <div className="flex items-center gap-1 mb-0.5">
                <MapPin size={11} className={TC.textMuted} />
                <span className={`text-xs ${TC.textMuted}`}>{addr.type ?? ''}</span>
              </div>
              <p className={`text-sm pl-4 ${TC.text}`}>
                {[
                  addr.street,
                  addr.city,
                  addr.region && `${addr.region} ${addr.postal ?? ''}`,
                  addr.country,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            </div>
          ))}
        </DetailSection>
      )}

      {/* ── Events ── */}
      {(contact.events?.length ?? 0) > 0 && (
        <DetailSection id="events" label={t('field.events')}>
          {contact.events!.map((ev, i) => (
            <LVRow key={i} label={t(`event.${ev.type}`)}>
              {fmtLocalDate(ev.date)}
            </LVRow>
          ))}
        </DetailSection>
      )}

      {/* ── Organizations ── */}
      {(contact.organizations?.length ?? 0) > 0 && (
        <DetailSection id="orgs" label={t('field.organizations')}>
          {[
            ...contact.organizations!.filter((o) => o.current !== false && !o.endDate),
            ...contact.organizations!.filter((o) => o.current === false || !!o.endDate),
          ].map((org, i) => (
            <div key={i} className="py-1 border-b last:border-0 border-b-transparent">
              <div className="flex items-center gap-1">
                <Briefcase size={11} className={TC.textMuted} />
                {!org.endDate && <Star size={10} className="text-yellow-400 flex-shrink-0" />}
                <span className={`text-sm font-medium ${TC.text}`}>{org.name}</span>
              </div>
              {org.title && <p className={`text-xs pl-4 ${TC.textMuted}`}>{org.title}</p>}
              {org.department && <p className={`text-xs pl-4 ${TC.textMuted}`}>{org.department}</p>}
              {(org.startDate || org.endDate) && (
                <p className={`text-xs pl-4 ${TC.textMuted}`}>
                  {fmtLocalDate(org.startDate)} –{' '}
                  {org.endDate ? fmtLocalDate(org.endDate) : 'present'}
                </p>
              )}
            </div>
          ))}
        </DetailSection>
      )}

      {/* ── URLs ── */}
      {(contact.urls?.length ?? 0) > 0 && (
        <DetailSection id="urls" label={t('field.urls')}>
          {contact.urls!.map((u, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <Globe size={11} className={TC.textMuted} />
              <span className={`text-xs w-16 flex-shrink-0 ${TC.textMuted}`}>{u.type ?? ''}</span>
              <a
                href={u.value}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-sky-400 hover:text-sky-300 truncate"
              >
                {u.value.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
              </a>
            </div>
          ))}
        </DetailSection>
      )}

      {/* ── Messaging / IM ── */}
      {(contact.imClients?.length ?? 0) > 0 && (
        <DetailSection id="im" label={t('field.im_clients')}>
          {contact.imClients!.map((im, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <MessageSquare size={11} className={TC.textMuted} />
              <span className={`text-xs w-20 flex-shrink-0 ${TC.textMuted}`}>{im.protocol}</span>
              <span className={`text-sm ${TC.text}`}>{im.handle}</span>
            </div>
          ))}
        </DetailSection>
      )}

      {/* ── External relations ── */}
      {(contact.relationsExternal?.length ?? 0) > 0 && (
        <DetailSection id="relations-ext" label={t('field.relations_external')}>
          {contact.relationsExternal!.map((rel, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <Heart size={11} className={TC.textMuted} />
              <span className={`text-xs w-20 flex-shrink-0 ${TC.textMuted}`}>{rel.type ?? ''}</span>
              <span className={`text-sm ${TC.text}`}>{rel.person}</span>
            </div>
          ))}
        </DetailSection>
      )}

      {/* ── Tags ── */}
      {(contact.tags?.length ?? 0) > 0 && (
        <DetailSection id="tags" label={t('field.tags')}>
          <div className="flex flex-wrap gap-1 pt-1">
            {contact.tags!.map((tg) => (
              <TagPill key={tg} name={tg} />
            ))}
          </div>
        </DetailSection>
      )}

      {/* ── Groups ── */}
      {(contact.groups?.length ?? 0) > 0 && (
        <DetailSection id="groups" label={t('field.groups')}>
          <div className="flex flex-wrap gap-1 pt-1">
            {contact.groups!.map((g) => (
              <GroupBadge key={g.id} id={g.id} name={g.name ?? g.id} />
            ))}
          </div>
        </DetailSection>
      )}

      {/* ── Notes ── */}
      {contact.notesMd && (
        <DetailSection id="notes" label={t('field.notes')}>
          <NotesMdRenderer
            text={contact.notesMd}
            allContacts={allContacts}
            {...(onSelectContact ? { onSelectContact } : {})}
          />
        </DetailSection>
      )}

      {/* ── Custom fields ── */}
      {Object.keys(contact.customFields ?? {}).length > 0 && (
        <DetailSection id="custom" label={t('field.custom_fields')}>
          {Object.entries(contact.customFields ?? {}).map(([key, value]) => {
            const def = defs.find((d) => d.id === key)
            const label = def?.name ?? key
            let rendered: ReactNode

            if (def?.type === 'boolean') {
              rendered = value ? '✓' : '—'
            } else if (def?.type === 'date' && typeof value === 'string') {
              rendered = fmtDate(value, 'YYYY-MM-DD', locale)
            } else if (def?.type === 'url' && typeof value === 'string') {
              rendered = (
                <a
                  href={value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 hover:text-sky-300 underline"
                >
                  {value}
                </a>
              )
            } else {
              rendered = value == null ? '—' : String(value)
            }

            return (
              <LVRow key={key} label={label}>
                {rendered}
              </LVRow>
            )
          })}
        </DetailSection>
      )}

      {/* ── Related contacts (internal) ── */}
      {(contact.relationsInternal?.length ?? 0) > 0 && (
        <DetailSection id="relations-int" label={t('field.relations')}>
          {contact.relationsInternal!.map((rel, i) => {
            const linked = allContacts.find((c) => c.id === rel.contactId)
            const linkedName = linked ? computeDisplayName(linked, locale) : rel.contactId
            return (
              <div key={i} className="flex items-center gap-2 py-0.5">
                {linked ? (
                  <button
                    onClick={() => onSelectContact?.(rel.contactId)}
                    className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                  >
                    <ContactAvatar id={rel.contactId} name={linkedName} size={20} />
                    <span className="text-sm text-sky-400 hover:text-sky-300">{linkedName}</span>
                  </button>
                ) : (
                  <>
                    <ContactAvatar id={rel.contactId} name={linkedName} size={20} />
                    <span className={`text-sm ${TC.textMuted}`}>{linkedName}</span>
                  </>
                )}
                {rel.type && <span className={`text-xs ${TC.textMuted} ml-1`}>({rel.type})</span>}
              </div>
            )
          })}
        </DetailSection>
      )}

      {/* ── Reminders ── */}
      {(contact.reminders?.length ?? 0) > 0 && (
        <DetailSection id="reminders" label={t('field.reminders')}>
          {contact.reminders!.map((rem) => (
            <div key={rem.id} className="flex items-start gap-2 py-0.5">
              <Bell size={11} className={`${TC.textMuted} mt-0.5 flex-shrink-0`} />
              <div className="flex-1 min-w-0">
                <span className={`text-xs ${TC.textMuted} mr-2`}>{fmtLocalDate(rem.date)}</span>
                <span className={`text-sm ${rem.done ? `line-through ${TC.textMuted}` : TC.text}`}>
                  {rem.text}
                </span>
              </div>
            </div>
          ))}
        </DetailSection>
      )}

      {/* ── Activity placeholder ── */}
      <div className={`px-4 py-3 border-b ${TC.borderClass}`}>
        <p className={`text-xs ${TC.textMuted}`}>Activity log: P4</p>
      </div>

      {/* ── Sync state footer ── */}
      <div className={`px-4 py-3 text-xs ${TC.textMuted} space-y-0.5`}>
        <p>Created: {fmtTs(contact.createdAt)}</p>
        <p>Updated: {fmtTs(contact.updatedAt)}</p>
        <p>
          Lamport {contact.lamportTs} · device {devicePrefix}
        </p>
      </div>
    </aside>
  )
}
