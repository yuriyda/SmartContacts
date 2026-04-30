/**
 * @file TaskComposer.tsx
 * Inline create/edit form for a single contact task. Reused by ContactDetail.
 *
 * Rules:
 *  - Pure presentational. Caller wires onSave / onCancel and provides initial draft.
 *  - On Save: caller is responsible for building the full ContactTask with ulid() + timestamps.
 *  - exactOptionalPropertyTypes: only set optional keys when value is defined.
 */
import { useState } from 'react'
import { useApp } from './AppContext'

interface ComposerProps {
  initial: { text?: string; dueAt?: string; priority?: 1 | 2 | 3 | 4 | 5 }
  onSave: (draft: { text: string; dueAt?: string; priority?: 1 | 2 | 3 | 4 | 5 }) => void
  onCancel: () => void
}

export function TaskComposer({ initial, onSave, onCancel }: ComposerProps) {
  const { TC, t } = useApp()
  const [text, setText] = useState(initial.text ?? '')
  const [dueAt, setDueAt] = useState<string | undefined>(initial.dueAt)
  const [priority, setPriority] = useState<1 | 2 | 3 | 4 | 5 | undefined>(initial.priority)

  const submit = () => {
    const draft: { text: string; dueAt?: string; priority?: 1 | 2 | 3 | 4 | 5 } = {
      text: text.trim(),
    }
    if (dueAt !== undefined && dueAt !== '') draft.dueAt = dueAt
    if (priority !== undefined) draft.priority = priority
    onSave(draft)
  }

  return (
    <div className={`p-2 rounded ${TC.elevated} space-y-2`}>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('task.text_placeholder')}
        className={`w-full px-2 py-1 rounded border ${TC.borderClass} ${TC.elevated} ${TC.text} text-sm`}
      />
      <div className="flex gap-2 items-center">
        <input
          type="date"
          value={dueAt ?? ''}
          onChange={(e) => setDueAt(e.target.value || undefined)}
          className={`px-2 py-1 rounded border ${TC.borderClass} ${TC.elevated} ${TC.text} text-sm`}
        />
        <select
          value={priority ?? ''}
          onChange={(e) => {
            const v = e.target.value
            if (v === '') {
              setPriority(undefined)
            } else {
              setPriority(Number(v) as 1 | 2 | 3 | 4 | 5)
            }
          }}
          className={`px-2 py-1 rounded border ${TC.borderClass} ${TC.elevated} ${TC.text} text-sm`}
        >
          <option value="">{t('task.no_priority')}</option>
          <option value="1">P1</option>
          <option value="2">P2</option>
          <option value="3">P3</option>
          <option value="4">P4</option>
          <option value="5">P5</option>
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className={`px-3 py-1 rounded text-sm ${TC.elevated} ${TC.textSec}`}
        >
          {t('actions.cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="px-3 py-1 rounded text-sm bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t('actions.save')}
        </button>
      </div>
    </div>
  )
}
