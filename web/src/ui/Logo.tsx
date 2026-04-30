/**
 * @file Logo.tsx
 * Smart Contacts logo: decentralized graph (3 satellites + edges) with a
 * person silhouette at the center medallion. Emphasizes "you" inside a
 * network of contacts/devices.
 *
 * Rules: pure SVG; no theme dependency; size prop is the rendered px
 * (square). Color palette is sky-400/sky-600 to match the app accent.
 */

interface LogoProps {
  size?: number
}

const DEFAULT_SIZE = 24

export function Logo({ size = DEFAULT_SIZE }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Smart Contacts logo"
    >
      <line
        x1="16"
        y1="16"
        x2="6"
        y2="6"
        stroke="#38bdf8"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      <line
        x1="16"
        y1="16"
        x2="26"
        y2="9"
        stroke="#38bdf8"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      <line
        x1="16"
        y1="16"
        x2="22"
        y2="26"
        stroke="#38bdf8"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      <circle cx="6" cy="6" r="3" fill="#0ea5e9" />
      <circle cx="26" cy="9" r="3" fill="#0ea5e9" />
      <circle cx="22" cy="26" r="3" fill="#0ea5e9" />
      <circle cx="16" cy="16" r="6" fill="#0c4a6e" stroke="#38bdf8" strokeWidth="1.5" />
      <circle cx="16" cy="14" r="2" fill="#38bdf8" />
      <path d="M 12 19.8 c 0 -1.7 1.7 -2.8 4 -2.8 s 4 1.1 4 2.8" fill="#38bdf8" />
    </svg>
  )
}
