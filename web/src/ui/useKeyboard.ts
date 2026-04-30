/**
 * @file useKeyboard.ts
 * Global hotkey hook. Caller passes a map of bindings; the hook attaches a `keydown`
 * listener at document level and dispatches by combo.
 * Rules: inputs/textareas/contenteditable are skipped by default (skipInInput defaults true).
 * Do not add any UI or side effects here beyond the event listener.
 */
import { useEffect } from 'react'

// Combo string format: e.g. 'cmd+n', 'ctrl+,', 'esc', 'j', 'k', 'e', 'd', 't', '/', '?'
type Combo = string

export interface KeyBinding {
  combo: Combo
  description?: string
  handler: (e: KeyboardEvent) => void
  // When true (default), skips dispatch if focus is in an input/textarea/contenteditable
  skipInInput?: boolean
}

function comboMatches(combo: Combo, e: KeyboardEvent): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts[parts.length - 1]!
  const wantsCmd = parts.includes('cmd') || parts.includes('meta')
  const wantsCtrl = parts.includes('ctrl')
  const wantsShift = parts.includes('shift')
  const wantsAlt = parts.includes('alt')
  const eKey = e.key.toLowerCase()

  // Special-case Esc and ? aliases
  if (key === 'esc' && eKey !== 'escape') return false
  if (key === '?' && eKey !== '?') return false
  if (key !== 'esc' && key !== '?' && eKey !== key) return false

  // Modifier matching: on macOS we accept Meta, on others Ctrl
  const haveMeta = e.metaKey || e.ctrlKey
  if ((wantsCmd || wantsCtrl) !== haveMeta) return false
  if (wantsShift !== e.shiftKey) return false
  if (wantsAlt !== e.altKey) return false
  return true
}

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

export function useKeyboard(bindings: KeyBinding[]) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const b of bindings) {
        const skip = b.skipInInput !== false // default true
        if (skip && isInputFocused()) continue
        if (comboMatches(b.combo, e)) {
          e.preventDefault()
          b.handler(e)
          return
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [bindings])
}
