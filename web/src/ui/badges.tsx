/**
 * @file badges.tsx
 * Inline badge components for contact priority, group chips, and tag pills.
 * PriorityBadge — coloured dot for priority level (1=red…5=none).
 * GroupBadge — chip with deterministic colour derived from group id.
 * TagPill — small rounded label with optional selected state.
 * Rules: no DB access here; pure presentational. Colours determined by hashColor().
 */
import { useApp } from './AppContext'

// 12-colour palette (Tailwind 500 hues) for deterministic colouring.
const HASH_PALETTE = [
  '#ef4444', // red-500
  '#f97316', // orange-500
  '#eab308', // yellow-500
  '#84cc16', // lime-500
  '#22c55e', // green-500
  '#14b8a6', // teal-500
  '#06b6d4', // cyan-500
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#a855f7', // purple-500
  '#ec4899', // pink-500
  '#f43f5e', // rose-500
]

function hashColor(s: string): string {
  const idx = [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HASH_PALETTE.length
  return HASH_PALETTE[idx]!
}

/** Coloured priority dot (1=red, 2=orange, 3=sky, 4=gray, 5=nothing). */
export function PriorityBadge({ priority }: { priority?: number }) {
  const { t } = useApp()
  if (!priority || priority >= 5) return null

  const colorMap: Record<number, string> = {
    1: 'bg-red-500',
    2: 'bg-orange-500',
    3: 'bg-sky-500',
    4: 'bg-gray-500',
  }
  const cls = colorMap[priority] ?? 'bg-gray-500'
  return (
    <span
      className={`w-2 h-2 rounded-full flex-shrink-0 ${cls}`}
      title={t(`priority.${priority}`)}
    />
  )
}

/** Coloured group chip with deterministic colour from group id. */
export function GroupBadge({ id, name }: { id: string; name: string }) {
  const color = hashColor(id)
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{ background: color + '33', color }}
    >
      {name}
    </span>
  )
}

/** Tag pill — small rounded label with theme-aware color. */
export function TagPill({
  name,
  onClick,
  selected,
}: {
  name: string
  onClick?: () => void
  selected?: boolean
}) {
  const color = hashColor(name)
  const base = 'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium'
  if (selected) {
    return (
      <span
        className={`${base} bg-sky-600/20 text-sky-300 cursor-pointer`}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        #{name}
      </span>
    )
  }
  return (
    <span
      className={`${base} ${onClick ? 'cursor-pointer' : ''}`}
      style={{ background: color + '22', color }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      #{name}
    </span>
  )
}

export { hashColor }
