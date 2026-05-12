/**
 * @file ContactRow.tsx
 * Single contact row rendered inside the MainList.
 * Shows avatar, display name, primary phone/email (comfortable mode), tags, and priority dot.
 * Modeled after TaskOrchestrator/tauri-app/src/ui/TaskRow.tsx — visual grammar and spacing.
 *
 * Focus model (per T1): rows are NOT focusable — no tabIndex, no role="button", no
 * onKeyDown. Keyboard nav (arrows, Enter, etc.) is global via useKeyboard in
 * SmartContactsApp.tsx. The visual cursor highlight reflects selectedId, not DOM focus.
 * data-contact-id is exposed so the marquee selection (T4) can hit-test rows.
 *
 * Rules: no DB access; only presentational. Uses AppContext for theme/density/locale.
 * DnD: rows are made draggable on non-touch devices only (isTouchDevice guard).
 *       The dragged data is the contact id, transferred under DND_MIME.
 */
import { useState } from 'react'
import type { Contact } from '@smart-contacts/shared'
import { computeDisplayName, relationshipScore, countFilledFields } from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { readShowScore } from '../store/networkSettings'
import { PriorityBadge, TagPill } from './badges'
import { ContactAvatar } from './ContactAvatar'
import { DND_MIME, isTouchDevice } from './dnd'
import { Lock, EyeOff } from './icons'
import { ImportedFromGoogleBadge } from './sync/ImportedFromGoogleBadge'

interface ContactRowProps {
  contact: Contact
  selected: boolean
  /** True when this row is included in the multi-select set. */
  multiSelected?: boolean
  /** True when any row in the list is selected (controls checkbox visibility). */
  anySelected?: boolean
  onSelect: (e: React.MouseEvent) => void
  /** Called when the checkbox is clicked — always toggles, ignoring keyboard modifiers. */
  onToggleSelection?: (e: React.MouseEvent) => void
  /** Called on right-click — caller opens a context menu at e.clientX/clientY. */
  onContextMenu?: (id: string, e: React.MouseEvent) => void
  onTouch?: () => void
  onSoftDelete?: () => void
  onOpenEdit?: (id: string) => void
}

export function ContactRow({
  contact,
  selected,
  multiSelected = false,
  anySelected = false,
  onSelect,
  onToggleSelection,
  onContextMenu,
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

  // Visual grammar (modeled after TaskOrchestrator/tauri-app/src/ui/TaskRow.tsx:40-71):
  //   cursor (active row) ............ inset ring (sky-400/40)
  //   selected (in multi-set) ........ left 3px stripe (sky-500) + bg sky/10
  //   cursor AND selected ............ ring strengthens to /60; stripe + bg also show
  //   hovered (else) ................. soft inset ring (sky-400/20) + bg sky/5
  //   neither ........................ no decoration
  // Hovered uses useState driven by onMouseEnter/Leave (TO pattern) — Tailwind
  // hover:bg-* alone is too subtle on dark themes. Hover styling is suppressed
  // when the row is the cursor (its ring is stronger) or in the selection set
  // (the stripe is more salient).
  // ring + box-shadow stripe coexist via Tailwind's chained box-shadow variables.
  const isCursor = selected
  const isInSet = multiSelected
  const [hovered, setHovered] = useState(false)
  const cursorRing = isCursor
    ? isInSet
      ? 'ring-1 ring-inset ring-sky-400/60'
      : 'ring-1 ring-inset ring-sky-400/40'
    : ''
  const selectionPaint = isInSet ? 'shadow-[inset_3px_0_0_0_#0ea5e9] bg-sky-500/10' : ''
  const hoverPaint =
    !isCursor && !isInSet && hovered ? 'ring-1 ring-inset ring-sky-400/20 bg-sky-500/5' : ''
  // Cursor row gets the brightest text regardless of multi-set membership; rows in the
  // set (but not cursor) are slightly less emphasized; neither = muted.
  const textClass = isCursor ? 'text-sky-100' : isInSet ? TC.text : TC.textSec
  const rowBg = [cursorRing, selectionPaint, hoverPaint, textClass].filter(Boolean).join(' ')

  return (
    <div
      data-contact-id={contact.id}
      onClick={onSelect}
      onDoubleClick={() => onOpenEdit?.(contact.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault()
          onContextMenu(contact.id, e)
        }
      }}
      role="option"
      aria-selected={multiSelected || selected}
      {...(!isTouchDevice && {
        draggable: true,
        onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
          // Mirrors TaskOrchestrator/tauri-app/src/TaskOrchestrator.tsx:606-609 pattern.
          // Single MIME, single effectAllowed value matching dropEffect on the
          // target side. WebView2 (Tauri Windows) does not fire drop unless
          // both sides agree on a single effect.
          e.dataTransfer.setData(DND_MIME, contact.id)
          e.dataTransfer.effectAllowed = 'copy'
        },
      })}
      className={[
        // rounded-md so the cursor ring + selection stripe + hover ring all
        // get rounded corners (Tailwind's ring is implemented as box-shadow
        // and follows the element's border-radius).
        'group flex items-center gap-3 px-3 rounded-md cursor-pointer transition-colors outline-none',
        density === 'compact' ? 'py-1' : 'py-2',
        rowBg,
      ].join(' ')}
    >
      {/* Checkbox: always visible when any row is multi-selected; otherwise hover-only */}
      <input
        type="checkbox"
        checked={multiSelected}
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelection?.(e)
        }}
        onChange={() => undefined}
        aria-label="Select contact"
        className={[
          'flex-shrink-0 cursor-pointer rounded accent-sky-500',
          anySelected || multiSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        ].join(' ')}
      />
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
          <ImportedFromGoogleBadge show={!!contact.googleResourceName} />
        </div>
        {density !== 'compact' && (
          <div className={`truncate text-[11px] ${TC.textMuted}`}>
            {primaryPhone?.value ?? primaryEmail?.value ?? '\u00a0'}
          </div>
        )}
      </div>

      {/* Show up to 2 tags + a +N badge for the remainder. The full list is
        visible in the detail panel; the badge surfaces hidden tags so a tag
        added via DnD doesn't disappear from view when the contact already
        has 2 tags (addContactToTag appends to the end). Tooltip lists them. */}
      {(() => {
        const all = contact.tags ?? []
        const visible = all.slice(0, 2)
        const hidden = all.slice(2)
        return (
          <>
            {visible.map((tg) => (
              <TagPill key={tg} name={tg} />
            ))}
            {hidden.length > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${TC.elevated} ${TC.textMuted}`}
                title={hidden.map((t) => `#${t}`).join(' ')}
                aria-label={`${hidden.length} more tags: ${hidden.join(', ')}`}
              >
                +{hidden.length}
              </span>
            )}
          </>
        )
      })()}

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
