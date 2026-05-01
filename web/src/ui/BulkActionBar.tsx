/**
 * @file BulkActionBar.tsx
 * Compact horizontal action bar shown above MainList when 2+ contacts are multi-selected.
 * Spec §19.2.
 *
 * Rules:
 *  - Pure presentational: parent decides visibility (do not render when count < 2).
 *  - Buttons emit callbacks; parent owns the actual mutation logic.
 *  - When scope === 'trash', show Restore + Delete (hard delete planned later — for now soft-delete still routes).
 *    Hide Hide / Protect / Touch in trash scope.
 */
import {
  Trash2,
  RotateCcw,
  EyeOff,
  Eye,
  Lock,
  Clock,
  Tag,
  Users,
  AlertTriangle,
  Download,
  X,
} from './icons'
import type { LucideIcon } from 'lucide-react'
import type { ContactFilters } from './filterTypes'
import { useApp } from './AppContext'

export interface BulkActionBarProps {
  count: number
  scope: ContactFilters['scope']
  onDelete: () => void
  onRestore: () => void
  onHide: () => void
  onUnhide: () => void
  onProtect: () => void
  onUnprotect: () => void
  onTouch: () => void
  onAddTag: () => void
  onAddToGroup: () => void
  onSetPriority: () => void
  onExport: () => void
  onClear: () => void
}

interface BulkButtonProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  variant?: 'default' | 'danger'
}

function BulkButton({ icon: Icon, label, onClick, variant = 'default' }: BulkButtonProps) {
  const { TC } = useApp()
  const cls =
    variant === 'danger'
      ? `text-red-400 hover:text-red-300 ${TC.elevated}`
      : `${TC.textSec} hover:${TC.text} ${TC.elevated}`
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${cls}`}
    >
      <Icon size={12} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export function BulkActionBar({
  count,
  scope,
  onDelete,
  onRestore,
  onHide,
  onUnhide,
  onProtect,
  onUnprotect,
  onTouch,
  onAddTag,
  onAddToGroup,
  onSetPriority,
  onExport,
  onClear,
}: BulkActionBarProps) {
  const { TC, t } = useApp()
  const inTrash = scope === 'trash'
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 border-b ${TC.borderClass} ${TC.elevated} flex-shrink-0`}
    >
      <span className={`${TC.textSec} text-xs whitespace-nowrap`}>
        {t('bulk.selected', { n: String(count) })}
      </span>
      <div className="flex-1 flex items-center gap-1 overflow-x-auto">
        {inTrash ? (
          <>
            <BulkButton icon={RotateCcw} label={t('actions.restore')} onClick={onRestore} />
            <BulkButton
              icon={Trash2}
              label={t('actions.delete')}
              onClick={onDelete}
              variant="danger"
            />
          </>
        ) : (
          <>
            <BulkButton
              icon={Trash2}
              label={t('actions.delete')}
              onClick={onDelete}
              variant="danger"
            />
            <BulkButton icon={EyeOff} label={t('actions.hide')} onClick={onHide} />
            <BulkButton icon={Eye} label={t('actions.unhide')} onClick={onUnhide} />
            <BulkButton icon={Lock} label={t('actions.protect')} onClick={onProtect} />
            <BulkButton icon={Lock} label={t('actions.unprotect')} onClick={onUnprotect} />
            <BulkButton icon={Clock} label={t('actions.touch')} onClick={onTouch} />
            <BulkButton icon={Tag} label={t('actions.add_tag')} onClick={onAddTag} />
            <BulkButton icon={Users} label={t('actions.add_to_group')} onClick={onAddToGroup} />
            <BulkButton
              icon={AlertTriangle}
              label={t('actions.set_priority')}
              onClick={onSetPriority}
            />
            <BulkButton icon={Download} label={t('actions.export_selected')} onClick={onExport} />
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label={t('actions.clear_selection')}
        className={`p-1 rounded ${TC.textMuted} hover:${TC.text}`}
      >
        <X size={12} />
      </button>
    </div>
  )
}
