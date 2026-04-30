/**
 * @file InteractionComposer.tsx
 * Inline create/edit form for a single interaction. Reused by ContactDetail.
 *
 * Rules:
 *  - Pure presentational. Caller wires onSave / onCancel and provides initial draft.
 *  - On Save: caller is responsible for ulid() + timestamps + lamport (via repo.upsert).
 */
import { useState } from 'react'
import type { InteractionChannel } from '@smart-contacts/shared'
import { useApp } from './AppContext'

const CHANNELS: InteractionChannel[] = ['call', 'meet', 'message', 'email', 'social', 'other']

interface ComposerInitial {
  channel?: InteractionChannel
  at?: string
  noteMd?: string
}

interface ComposerProps {
  initial: ComposerInitial
  onSave: (draft: { channel: InteractionChannel; at: string; noteMd: string }) => void
  onCancel: () => void
}

export function InteractionComposer({ initial, onSave, onCancel }: ComposerProps) {
  const { TC, t } = useApp()
  const [channel, setChannel] = useState<InteractionChannel>(initial.channel ?? 'message')
  const [at, setAt] = useState<string>(
    initial.at
      ? initial.at.length > 16
        ? initial.at.slice(0, 16)
        : initial.at
      : new Date().toISOString().slice(0, 16),
  )
  const [noteMd, setNoteMd] = useState<string>(initial.noteMd ?? '')

  const submit = () => {
    // Normalize datetime-local value (yyyy-MM-ddTHH:mm) to full ISO — interpret as local time
    let normalized = at
    if (at.length === 16) {
      // datetime-local gives local time; convert to UTC ISO
      const d = new Date(at)
      normalized = isNaN(d.getTime()) ? at + ':00.000Z' : d.toISOString()
    }
    onSave({ channel, at: normalized, noteMd })
  }

  return (
    <div className={`p-2 rounded ${TC.elevated} space-y-2`}>
      <div className="flex gap-2 items-center flex-wrap">
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value as InteractionChannel)}
          className={`px-2 py-1 rounded border ${TC.borderClass} ${TC.elevated} ${TC.text} text-sm`}
        >
          {CHANNELS.map((ch) => (
            <option key={ch} value={ch}>
              {t(`interaction_channel.${ch}`)}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          className={`px-2 py-1 rounded border ${TC.borderClass} ${TC.elevated} ${TC.text} text-sm`}
        />
      </div>
      <textarea
        value={noteMd}
        onChange={(e) => setNoteMd(e.target.value)}
        placeholder={t('interaction.note_placeholder')}
        rows={3}
        className={`w-full px-2 py-1 rounded border ${TC.borderClass} ${TC.elevated} ${TC.text} text-sm resize-y`}
      />
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
          className="px-3 py-1 rounded text-sm bg-sky-600 hover:bg-sky-500 text-white"
        >
          {t('actions.save')}
        </button>
      </div>
    </div>
  )
}
