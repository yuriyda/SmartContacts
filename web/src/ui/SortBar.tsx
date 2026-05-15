/**
 * @file SortBar.tsx
 * Pill-style sort buttons over the contacts list. Adapted from
 * /workspace/TaskOrchestrator-main/tauri-app/src/ui/SortBar.tsx — same toggle
 * pattern (click active field flips dir; click another field switches to it
 * with the field's natural default direction).
 *
 * Rules: presentational only. Caller (SmartContactsApp) owns the sort state
 * and persists it; this component just emits onToggle(field).
 */
import {
  CONTACT_SORT_FIELDS,
  type ContactSort,
  type ContactSortField,
} from '@smart-contacts/shared'
import { ImageIcon } from 'lucide-react'
import { useApp } from './AppContext'

interface SortBarProps {
  sort: ContactSort | null
  onToggle: (field: ContactSortField) => void
  /** Optional "Show only contacts with a Google photo" toggle. Rendered only
   *  when both props are supplied so the bar stays usable on screens that
   *  have no Google sync wired (e.g. the offline / future PWA target). */
  withPhotoOnly?: boolean
  onToggleWithPhoto?: () => void
}

export function SortBar({ sort, onToggle, withPhotoOnly, onToggleWithPhoto }: SortBarProps) {
  const { TC, t } = useApp()
  return (
    <div className={`flex items-center gap-1 flex-wrap px-3 py-2 border-b ${TC.borderClass}`}>
      <span className={`text-xs mr-1 ${TC.textMuted}`}>{t('sort.label')}</span>
      {CONTACT_SORT_FIELDS.map((field) => {
        const active = sort?.field === field
        return (
          <button
            key={field}
            type="button"
            onClick={() => onToggle(field)}
            className={[
              'flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors',
              active
                ? 'bg-sky-600/20 text-sky-300 border border-sky-600/35'
                : `${TC.elevated} ${TC.textSec} border border-transparent`,
            ].join(' ')}
          >
            {t(`sort.${field}`)}
            {active && (
              <span style={{ fontSize: 10, lineHeight: 1 }}>{sort.dir === 'asc' ? '↑' : '↓'}</span>
            )}
          </button>
        )
      })}
      {onToggleWithPhoto && (
        <button
          type="button"
          onClick={onToggleWithPhoto}
          aria-pressed={withPhotoOnly === true}
          title={t('filter.with_photo_hint') || 'Show only contacts with a Google photo'}
          className={[
            'ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors',
            withPhotoOnly === true
              ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-600/35'
              : `${TC.elevated} ${TC.textSec} border border-transparent`,
          ].join(' ')}
        >
          <ImageIcon size={12} />
          {t('filter.with_photo') || 'With photo'}
        </button>
      )}
    </div>
  )
}
