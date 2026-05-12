// RO-INVARIANT: L5.2 — visible marker on Google-imported contacts to set correct edit expectations.
//
// Renders a compact inline badge next to a contact name when the contact was imported from Google.
// Rules:
//  - No edit affordance. Pure indicator only.
//  - Must not disrupt line-height or truncation of adjacent name text.
//  - Controlled by `show` prop — returns null when false, so callers can unconditionally render.

export interface ImportedFromGoogleBadgeProps {
  /** Show only when truthy — convenience for callers that conditionally render. */
  show: boolean
  /** Optional class extension for size tweaks. */
  className?: string
}

export function ImportedFromGoogleBadge({ show, className = '' }: ImportedFromGoogleBadgeProps) {
  if (!show) return null

  return (
    <span
      title="Imported from Google. Changes are kept locally only. Two-way sync coming in a future version."
      aria-label="Imported from Google"
      className={[
        // Inline circle badge: small, non-breaking, sits right of the name
        'inline-flex items-center justify-center',
        'w-4 h-4 rounded-full',
        'bg-sky-500/20 border border-sky-400/40',
        'text-[9px] font-bold text-sky-300',
        'leading-none flex-shrink-0',
        'ml-1 align-middle',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      G
    </span>
  )
}
