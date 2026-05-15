/**
 * @file AvatarLightbox.tsx
 * Fullscreen modal that shows a contact's avatar at native size.
 *
 * Rules:
 *  - Pure presentational; no DB access.
 *  - Close on Esc, backdrop click, or close-button click.
 *  - Image is constrained to viewport (max 90vw × 90vh) and centered.
 *  - Disabled when src is null/empty (caller should not render in that case).
 */
import { useEffect, useCallback } from 'react'

export interface AvatarLightboxProps {
  open: boolean
  src: string | null
  alt: string
  onClose: () => void
}

export function AvatarLightbox({ open, src, alt, onClose }: AvatarLightboxProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, handleKeyDown])

  if (!open || src === null || src === '') return null

  return (
    <div
      className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center cursor-zoom-out"
      onClick={onClose}
      role="dialog"
      aria-label={alt}
      aria-modal="true"
    >
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl leading-none flex items-center justify-center transition-colors"
      >
        ×
      </button>
    </div>
  )
}
