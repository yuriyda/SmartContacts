/**
 * @file ContactAvatar.tsx
 * Deterministic colour-on-id avatar with initials. Used in ContactRow and ContactDetail.
 * Rules: pure presentational; no DB access. Colour determined by hashColor(id).
 * Size is in px; defaults to 36. The circle background is derived from the contact id,
 * so the same contact always gets the same colour across sessions and devices.
 *
 * If `photoDataUrl` is provided, renders the image on top of the colour disc.
 * The colour disc remains as a sized backdrop so layout never shifts while
 * the lazy photo load is in flight. `loading="eager"` is intentional: when
 * the consumer hands us bytes-from-local-DB, we want them painted immediately.
 */
import { useMemo } from 'react'
import { hashColor } from './badges'

export interface ContactAvatarProps {
  id: string
  name: string
  size?: number // px, default 36
  /** Optional data:URL (or blob:URL) for a locally cached avatar image. */
  photoDataUrl?: string | null | undefined
  /**
   * Optional click handler. Wired only when a real photo is shown — clicking
   * an initials disc does nothing, so we don't render an interactive cursor
   * for it. Typical use: open a lightbox.
   */
  onPhotoClick?: (() => void) | undefined
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function ContactAvatar({
  id,
  name,
  size = 36,
  photoDataUrl,
  onPhotoClick,
}: ContactAvatarProps) {
  const bg = useMemo(() => hashColor(id), [id])
  const ini = useMemo(() => initialsFor(name), [name])
  const hasPhoto = photoDataUrl !== null && photoDataUrl !== undefined && photoDataUrl !== ''
  const clickable = hasPhoto && onPhotoClick !== undefined

  const commonStyle = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.4),
    background: bg,
  }
  const commonClass =
    'inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 select-none overflow-hidden relative'

  const inner = hasPhoto ? (
    <img
      src={photoDataUrl!}
      alt=""
      className="absolute inset-0 w-full h-full object-cover"
      draggable={false}
    />
  ) : (
    ini
  )

  if (clickable) {
    return (
      <button
        type="button"
        onClick={onPhotoClick}
        aria-label={`View photo of ${name}`}
        className={`${commonClass} cursor-zoom-in p-0 border-0 outline-none focus-visible:ring-2 focus-visible:ring-sky-400`}
        style={commonStyle}
      >
        {inner}
      </button>
    )
  }

  return (
    <span className={commonClass} style={commonStyle} aria-label={name}>
      {inner}
    </span>
  )
}
