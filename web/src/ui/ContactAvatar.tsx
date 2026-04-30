/**
 * @file ContactAvatar.tsx
 * Deterministic colour-on-id avatar with initials. Used in ContactRow and ContactDetail.
 * Rules: pure presentational; no DB access. Colour determined by hashColor(id).
 * Size is in px; defaults to 36. The circle background is derived from the contact id,
 * so the same contact always gets the same colour across sessions and devices.
 */
import { useMemo } from 'react'
import { hashColor } from './badges'

export interface ContactAvatarProps {
  id: string
  name: string
  size?: number // px, default 36
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function ContactAvatar({ id, name, size = 36 }: ContactAvatarProps) {
  const bg = useMemo(() => hashColor(id), [id])
  const ini = useMemo(() => initialsFor(name), [name])
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 select-none"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: bg }}
      aria-label={name}
    >
      {ini}
    </span>
  )
}
