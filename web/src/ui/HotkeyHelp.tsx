/**
 * @file HotkeyHelp.tsx
 * Keyboard shortcuts reference panel (modal overlay). Toggled by the `?` hotkey.
 * Rules: no DB access; read-only display component. All key descriptions come from i18n.
 * Import only from AppContext and icons — no other UI dependencies.
 */
import { useApp } from './AppContext'
import { X } from './icons'

interface HotkeyHelpProps {
  open: boolean
  onClose: () => void
}

const ROWS = [
  ['Ctrl/Cmd+N', 'hotkey.add'],
  ['Ctrl/Cmd+,', 'hotkey.settings'],
  ['Ctrl/Cmd+Z', 'hotkey.undo'],
  ['Ctrl/Cmd+Shift+Z', 'hotkey.redo'],
  ['j', 'hotkey.next'],
  ['k', 'hotkey.prev'],
  ['e', 'hotkey.edit'],
  ['Del', 'hotkey.delete'],
  ['t', 'hotkey.touch'],
  ['/', 'hotkey.search'],
  ['?', 'hotkey.help'],
] as const

export function HotkeyHelp({ open, onClose }: HotkeyHelpProps) {
  const { t, TC } = useApp()
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${TC.surface} ${TC.text} border ${TC.borderClass} rounded-lg shadow-2xl w-80 p-4`}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Keyboard shortcuts</h3>
          <button onClick={onClose} className={TC.textSec}>
            <X size={14} />
          </button>
        </div>
        <ul className="text-sm space-y-1.5">
          {ROWS.map(([combo, key]) => (
            <li key={combo} className="flex items-center justify-between">
              <span className={TC.textMuted}>{t(key)}</span>
              <kbd
                className={`px-1.5 py-0.5 text-[11px] rounded border ${TC.borderClass} ${TC.surfaceAlt}`}
              >
                {combo}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
