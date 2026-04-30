/**
 * @file ContactRow.tsx
 * Single contact row rendered inside the MainList.
 * Shows avatar, display name, primary phone/email (comfortable mode), tags, and priority dot.
 * Modeled after TaskOrchestrator/tauri-app/src/ui/TaskRow.tsx — visual grammar and spacing.
 * Rules: no DB access; only presentational. Uses AppContext for theme/density/locale.
 */
import type { Contact } from '@smart-contacts/shared'
import { computeDisplayName } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { PriorityBadge, TagPill } from './badges'
import { ContactAvatar } from './ContactAvatar'

interface ContactRowProps {
  contact: Contact
  selected: boolean
  onSelect: () => void
  onTouch?: () => void
  onSoftDelete?: () => void
}

export function ContactRow({
  contact,
  selected,
  onSelect,
  onTouch: _onTouch,
  onSoftDelete: _onSoftDelete,
}: ContactRowProps) {
  const { TC, density, locale } = useApp()
  const name = computeDisplayName(contact, locale)
  const primaryPhone = contact.phones?.find((p) => p.primary) ?? contact.phones?.[0]
  const primaryEmail = contact.emails?.find((e) => e.primary) ?? contact.emails?.[0]

  const avatarSize = density === 'compact' ? 24 : 36

  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      role="button"
      tabIndex={0}
      className={[
        'flex items-center gap-3 px-3 cursor-pointer transition-colors outline-none',
        density === 'compact' ? 'py-1' : 'py-2',
        selected ? 'bg-sky-600/20 text-sky-100' : `${TC.textSec} ${TC.hoverBg}`,
      ].join(' ')}
    >
      <ContactAvatar id={contact.id} name={name} size={avatarSize} />

      <div className="flex-1 min-w-0">
        <div className={`truncate text-sm ${selected ? 'text-sky-100' : TC.text}`}>{name}</div>
        {density !== 'compact' && (
          <div className={`truncate text-[11px] ${TC.textMuted}`}>
            {primaryPhone?.value ?? primaryEmail?.value ?? '\u00a0'}
          </div>
        )}
      </div>

      {/* Show up to 2 tags */}
      {(contact.tags ?? []).slice(0, 2).map((tg) => (
        <TagPill key={tg} name={tg} />
      ))}

      {contact.priority !== undefined && <PriorityBadge priority={contact.priority} />}
    </div>
  )
}
