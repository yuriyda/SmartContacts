/**
 * @file usePrompt.tsx
 * Promise-based text-input prompt. Hook returns:
 *  - prompt(opts): Promise<string | null> — resolves with the trimmed string, or null on cancel/Esc.
 *  - Mount: ReactNode — render once high in the tree.
 *
 * Replaces window.prompt for tag/group/priority prompts in P9.T7.
 *
 * Rules:
 *  - Single in-flight prompt at a time; calling prompt() while one is pending replaces it.
 *  - No DB access; pure UI.
 *  - Closing via backdrop click, Cancel button, or Esc all resolve with null.
 */
import { useCallback, useState, useEffect, useRef, type ReactNode } from 'react'
import { useApp } from './AppContext'

export interface PromptOptions {
  title: string
  body?: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
}

interface PendingState {
  opts: PromptOptions
  resolve: (v: string | null) => void
}

export interface UsePromptResult {
  prompt: (opts: PromptOptions) => Promise<string | null>
  Mount: ReactNode
}

export function usePrompt(): UsePromptResult {
  const { TC, t } = useApp()
  const [pending, setPending] = useState<PendingState | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (pending) {
      setValue(pending.opts.initialValue ?? '')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [pending])

  const prompt = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => setPending({ opts, resolve }))
  }, [])

  const onConfirm = useCallback(() => {
    const trimmed = value.trim()
    pending?.resolve(trimmed.length > 0 ? trimmed : null)
    setPending(null)
  }, [pending, value])

  const onCancel = useCallback(() => {
    pending?.resolve(null)
    setPending(null)
  }, [pending])

  const Mount: ReactNode = pending ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className={`border rounded-xl shadow-2xl p-6 w-96 ${TC.surface} ${TC.borderClass}`}>
        <h2 className={`text-sm font-semibold mb-2 ${TC.text}`}>{pending.opts.title}</h2>
        {pending.opts.body && <p className={`text-sm mb-3 ${TC.textSec}`}>{pending.opts.body}</p>}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={pending.opts.placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onConfirm()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
          className={`w-full mb-4 px-3 py-2 rounded border ${TC.borderClass} ${TC.elevated} ${TC.text} text-sm`}
        />
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className={`px-4 py-1.5 text-sm rounded-lg ${TC.elevated} ${TC.textSec}`}
          >
            {pending.opts.cancelLabel ?? t('actions.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-1.5 text-sm rounded-lg bg-sky-600 hover:bg-sky-500 text-white"
          >
            {pending.opts.confirmLabel ?? t('actions.save')}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { prompt, Mount }
}
