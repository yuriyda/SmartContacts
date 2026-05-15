// RO-INVARIANT: L5.2 — visible marker on Google-imported contacts to set correct edit expectations.
//
// Renders a compact inline badge next to a contact name when the contact was imported from Google.
// When `hasAvatar` is set, an additional small picture icon is rendered adjacent
// to the G logo to signal that a profile photo is available. The icon (instead
// of the previous coloured dot) makes the meaning self-evident — same glyph as
// the "With photo" filter toggle in SortBar, so the visual vocabulary stays
// consistent across the app.
//
// Rules:
//  - No edit affordance. Pure indicator only.
//  - Must not disrupt line-height or truncation of adjacent name text.
//  - Controlled by `show` prop — returns null when false, so callers can unconditionally render.

import { ImageIcon } from 'lucide-react'

export interface ImportedFromGoogleBadgeProps {
  /** Show only when truthy — convenience for callers that conditionally render. */
  show: boolean
  /** When true, a small picture icon is rendered next to the G to signal that
   *  Google has a profile photo for this contact (regardless of whether the
   *  bytes have been fetched locally yet). */
  hasAvatar?: boolean
  /** Optional class extension for size tweaks. */
  className?: string
}

/**
 * Inline SVG of Google's official multi-colour "G" mark. Public asset
 * (Google brand kit). 48×48 source canvas; we render at any size via
 * CSS width/height.
 */
function GoogleGMark({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#FFC107"
        d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
      />
      <path
        fill="#FF3D00"
        d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
      />
      <path
        fill="#1976D2"
        d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
      />
    </svg>
  )
}

export function ImportedFromGoogleBadge({
  show,
  hasAvatar = false,
  className = '',
}: ImportedFromGoogleBadgeProps) {
  if (!show) return null

  return (
    <span
      title={
        hasAvatar
          ? 'Imported from Google · profile photo available'
          : 'Imported from Google. Changes are kept locally only. Two-way sync coming in a future version.'
      }
      aria-label="Imported from Google"
      className={['inline-flex items-center gap-1 ml-1 align-middle flex-shrink-0', className]
        .filter(Boolean)
        .join(' ')}
    >
      <GoogleGMark size={12} />
      {hasAvatar && (
        <ImageIcon
          size={11}
          aria-label="Has profile photo"
          className="text-emerald-500 flex-shrink-0"
        />
      )}
    </span>
  )
}
