/**
 * @file Card.tsx
 * Shared card chrome for NetworkDashboard widgets: header (title + count badge) + body slot.
 * Theme-aware via useApp(). No business logic.
 * Rules: pure presentational component; no store access, no mutations.
 */
import type { ReactNode } from 'react'
import { useApp } from '../AppContext'

interface CardProps {
  title: string
  count?: number
  children: ReactNode
  emptyHint?: string
  isEmpty?: boolean
}

export function Card({ title, count, children, emptyHint, isEmpty }: CardProps) {
  const { TC } = useApp()
  return (
    <div className={`rounded border ${TC.borderClass} ${TC.elevated} flex flex-col min-h-[200px]`}>
      <div className={`flex items-center justify-between px-3 py-2 border-b ${TC.borderClass}`}>
        <h3 className={`text-sm font-medium ${TC.text}`}>{title}</h3>
        {typeof count === 'number' && count > 0 && (
          <span className="px-2 py-0.5 rounded text-[10px] bg-sky-600/20 text-sky-300">
            {count}
          </span>
        )}
      </div>
      <div className={`flex-1 px-3 py-2 ${TC.textSec} text-sm overflow-auto`}>
        {isEmpty && emptyHint ? (
          <p className={`${TC.textMuted} text-xs italic`}>{emptyHint}</p>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
