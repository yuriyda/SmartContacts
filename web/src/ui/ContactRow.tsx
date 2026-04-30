/**
 * @file ContactRow.tsx
 * Single contact row rendered inside the MainList.
 * Shows avatar, display name, primary phone/email (comfortable mode), tags, and priority dot.
 * Modeled after TaskOrchestrator/tauri-app/src/ui/TaskRow.tsx — visual grammar and spacing.
 * Rules: no DB access; only presentational. Uses AppContext for theme/density/locale.
 * DnD: rows are made draggable on non-touch devices only (isTouchDevice guard).
 *       The dragged data is the contact id, transferred under DND_MIME.
 */
import type { Contact } from '@smart-contacts/shared'
import { computeDisplayName, relationshipScore, countFilledFields } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { readShowScore } from '../store/networkSettings'
import { PriorityBadge, TagPill } from './badges'
import { ContactAvatar } from './ContactAvatar'
import { DND_MIME, isTouchDevice } from './dnd'
import { Lock, EyeOff } from './icons'

interface ContactRowProps {
  contact: Contact
  selected: boolean
  onSelect: () => void
  onTouch?: () => void
  onSoftDelete?: () => void
  onOpenEdit?: (id: string) => void
}

export function ContactRow({
  contact,
  selected,
  onSelect,
  onTouch: _onTouch,
  onSoftDelete: _onSoftDelete,
  onOpenEdit,
}: ContactRowProps) {
  const { TC, density, locale, metaSettings } = useApp()
  const name = computeDisplayName(contact, locale)
  const primaryPhone = contact.phones?.find((p) => p.primary) ?? contact.phones?.[0]
  const primaryEmail = contact.emails?.find((e) => e.primary) ?? contact.emails?.[0]

  const avatarSize = density === 'compact' ? 24 : 36

  // Phase A score in ContactRow ignores interactions; B will thread the count through if needed.
  const showScore = readShowScore(metaSettings)
  const score = showScore
    ? relationshipScore({
        // priority is stored as number in Contact; cast to the narrower union is safe (DB enforces valid values).
        // exactOptionalPropertyTypes: omit the key entirely when undefined to avoid type error.
        ...(contact.priority !== undefined
          ? { priority: contact.priority as 1 | 2 | 3 | 4 | 5 }
          : {}),
        // lastContactedAt is string|null|undefined; omit when null/undefined.
        ...(contact.lastContactedAt != null ? { lastContactedAt: contact.lastContactedAt } : {}),
        recentInteractionCount: 0,
        filledFieldCount: countFilledFields(contact),
        now: Date.now(),
      })
    : 0
  const stars = Math.round(score / 20)

  return (
    <div
      onClick={onSelect}
      onDoubleClick={() => onOpenEdit?.(contact.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      role="button"
      tabIndex={0}
      {...(!isTouchDevice && {
        draggable: true,
        onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
          e.dataTransfer.setData(DND_MIME, contact.id)
          e.dataTransfer.effectAllowed = 'copy'
        },
      })}
      className={[
        'flex items-center gap-3 px-3 cursor-pointer transition-colors outline-none',
        density === 'compact' ? 'py-1' : 'py-2',
        selected ? 'bg-sky-600/20 text-sky-100' : `${TC.textSec} ${TC.hoverBg}`,
      ].join(' ')}
    >
      <ContactAvatar id={contact.id} name={name} size={avatarSize} />

      <div className="flex-1 min-w-0">
        <div className={`truncate text-sm ${selected ? 'text-sky-100' : TC.text}`}>
          {name}
          {contact.protected && (
            <Lock size={11} className="inline-block ml-1 text-sky-400" aria-label="Protected" />
          )}
          {contact.hidden && (
            <EyeOff size={11} className="inline-block ml-1 text-sky-400" aria-label="Hidden" />
          )}
        </div>
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
      {showScore && (
        <span className="text-[10px] text-amber-400" aria-label={`Score ${score}`}>
          {'★'.repeat(stars)}
          {'☆'.repeat(5 - stars)}
        </span>
      )}
    </div>
  )
}
