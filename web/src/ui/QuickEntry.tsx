/**
 * @file QuickEntry.tsx
 * Inline-chips QuickEntry input. Token prefixes (#, !, /, +, @, *, ^, ~, >>, ?, tg:/gh:/lk:)
 * commit on space; remaining text is displayName. Enter creates a contact via the
 * onCommit callback. Tab opens the full ContactEditDialog (handled by parent).
 *
 * Layout: a flex row with chips followed by a text input. Suggestions dropdown
 * floats below for the current trailing token.
 *
 * Rules: no DB access; pure UI driven by props. Uses only useApp() for TC/t.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  tryCommitToken,
  getSuggestions,
  type Chip,
  type ParsedQuickEntry,
  type QuickEntryContext,
} from '@smart-contacts/shared'
import { useApp } from './AppContext'
import { Plus, X } from './icons'

interface QuickEntryProps {
  ctx: QuickEntryContext
  onCommit: (parsed: ParsedQuickEntry) => void // Enter pressed → create contact
  onTab: (parsed: ParsedQuickEntry) => void // Tab → open full dialog with prefilled fields
  onCancel: () => void // Esc → reset
}

export function QuickEntry({ ctx, onCommit, onTab, onCancel }: QuickEntryProps) {
  const { TC, t } = useApp()
  const [chips, setChips] = useState<Chip[]>([])
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState<
    Array<{ display: string; replace: string; type: string }>
  >([])
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Refresh suggestions when text changes
  useEffect(() => {
    const lastWord = text.split(/\s+/).slice(-1)[0] ?? ''
    setSuggestions(getSuggestions(lastWord, ctx))
    setActiveIdx(0)
  }, [text, ctx])

  const reset = useCallback(() => {
    setChips([])
    setText('')
    setSuggestions([])
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (v.endsWith(' ')) {
      const trimmed = v.trimEnd()
      const lastSpace = trimmed.lastIndexOf(' ')
      const word = lastSpace === -1 ? trimmed : trimmed.slice(lastSpace + 1)
      const prev = lastSpace === -1 ? '' : trimmed.slice(0, lastSpace)
      const commit = tryCommitToken(word)
      if (commit) {
        setChips((cs) => [...cs, commit.chip])
        setText(prev ? prev + ' ' : '')
        return
      }
    }
    setText(v)
  }

  const applySuggestion = (s: { replace: string }) => {
    const parts = text.split(/\s+/)
    parts[parts.length - 1] = s.replace
    const next = parts.join(' ') + ' '
    // Also try to commit immediately
    const trimmed = next.trimEnd()
    const lastSpace = trimmed.lastIndexOf(' ')
    const word = lastSpace === -1 ? trimmed : trimmed.slice(lastSpace + 1)
    const prev = lastSpace === -1 ? '' : trimmed.slice(0, lastSpace)
    const commit = tryCommitToken(word)
    if (commit) {
      setChips((cs) => [...cs, commit.chip])
      setText(prev ? prev + ' ' : '')
    } else {
      setText(next)
    }
    inputRef.current?.focus()
  }

  const buildParsed = useCallback((): ParsedQuickEntry => {
    // Parse remaining text as residual displayName + any uncommitted recognised tokens.
    // Strategy: split text on whitespace, walk; commit any tokens that match, the rest is name.
    const parts = text.split(/\s+/).filter(Boolean)
    const extraChips: Chip[] = []
    const nameWords: string[] = []
    for (const w of parts) {
      const c = tryCommitToken(w)
      if (c) extraChips.push(c.chip)
      else nameWords.push(w)
    }
    return { chips: [...chips, ...extraChips], displayName: nameWords.join(' ').trim() }
  }, [chips, text])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions[activeIdx]) {
        applySuggestion(suggestions[activeIdx])
        return
      }
      const parsed = buildParsed()
      if (parsed.chips.length === 0 && parsed.displayName === '') return
      onCommit(parsed)
      reset()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const parsed = buildParsed()
      onTab(parsed)
      reset()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      reset()
      onCancel()
      return
    }
    if (e.key === 'ArrowDown') {
      if (suggestions.length > 0) {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1))
      }
      return
    }
    if (e.key === 'ArrowUp') {
      if (suggestions.length > 0) {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
      }
      return
    }
    if (e.key === 'Backspace' && text === '' && chips.length > 0) {
      e.preventDefault()
      setChips((cs) => cs.slice(0, -1))
    }
  }

  const removeChip = (idx: number) => {
    setChips((cs) => cs.filter((_, i) => i !== idx))
    inputRef.current?.focus()
  }

  // Color map for chip types
  const chipBg = useMemo<Record<string, string>>(
    () => ({
      tag: 'bg-amber-600/30 text-amber-200',
      priority: 'bg-rose-600/30 text-rose-200',
      group: 'bg-emerald-600/30 text-emerald-200',
      phone: 'bg-sky-600/30 text-sky-200',
      email: 'bg-sky-600/30 text-sky-200',
      organization: 'bg-purple-600/30 text-purple-200',
      birthday: 'bg-pink-600/30 text-pink-200',
      nickname: 'bg-yellow-600/30 text-yellow-200',
      relation: 'bg-cyan-600/30 text-cyan-200',
      channel: 'bg-indigo-600/30 text-indigo-200',
      social: 'bg-teal-600/30 text-teal-200',
    }),
    [],
  )

  return (
    <div className="relative flex-1">
      <div
        onClick={() => inputRef.current?.focus()}
        className={`flex items-center flex-wrap gap-1 px-2 py-1 rounded text-sm cursor-text border ${TC.input}`}
      >
        <Plus size={14} className={TC.textMuted} />
        {chips.map((c, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono ${chipBg[c.type] ?? 'bg-gray-600/30'}`}
          >
            {c.raw}
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation()
                removeChip(i)
              }}
              className="opacity-60 hover:opacity-100"
              aria-label={`remove ${c.raw}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t('nav.add_contact')}
          className={`flex-1 min-w-[120px] outline-none bg-transparent ${TC.inputText}`}
        />
      </div>
      {suggestions.length > 0 && (
        <ul
          className={`absolute left-0 top-full mt-1 z-30 max-w-md w-full max-h-64 overflow-y-auto rounded shadow-lg ${TC.elevated} border ${TC.borderClass}`}
        >
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => applySuggestion(s)}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${
                  i === activeIdx ? 'bg-sky-600/30 text-sky-100' : `${TC.textSec} hover:${TC.text}`
                }`}
              >
                <span className="font-mono opacity-60">{s.replace}</span>
                <span>{s.display}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
