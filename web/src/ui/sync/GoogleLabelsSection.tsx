// RO-INVARIANT: INV-4 — Google Labels are read-only. No edit/delete affordance.
//
// Renders the list of Google Contact Group labels a contact belongs to.
// Only shown when the contact has at least one label membership.
// Labels are fetched from the DB via LabelRepo on mount and when contactId changes.
//
// Rules:
//  - No add/remove UI. Chips have no X button.
//  - Heading carries a tooltip explaining read-only status.
//  - Section is completely hidden when label list is empty.

import { useEffect, useState } from 'react'
import type { LabelRepo, GoogleLabelRow } from '@smart-contacts/shared'
import { useApp } from '../AppContext'

export interface GoogleLabelsSectionProps {
  contactId: string
  labelRepo: LabelRepo
}

export function GoogleLabelsSection({ contactId, labelRepo }: GoogleLabelsSectionProps) {
  const { TC } = useApp()
  const [labels, setLabels] = useState<GoogleLabelRow[]>([])

  useEffect(() => {
    let cancelled = false
    void labelRepo.listForContact(contactId).then((rows) => {
      if (!cancelled) setLabels(rows)
    })
    return () => {
      cancelled = true
    }
  }, [contactId, labelRepo])

  // Section is invisible when no memberships exist
  if (labels.length === 0) return null

  return (
    <div className={`px-4 py-3 border-b ${TC.borderClass}`}>
      {/* Heading row with "G" icon prefix */}
      <div className="flex items-center gap-1.5 mb-2">
        <span
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-sky-500/20 border border-sky-400/40 text-[9px] font-bold text-sky-300 leading-none flex-shrink-0"
          aria-hidden="true"
        >
          G
        </span>
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${TC.textMuted}`}
          title="Labels imported from Google. Read-only in this version."
        >
          Google Labels
        </span>
      </div>

      {/* Label chips — outlined sky style, no remove button */}
      <div className="flex flex-wrap gap-1">
        {labels.map((lbl) => (
          <span
            key={lbl.resourceName}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-sky-500/40 text-sky-300 bg-sky-500/5"
          >
            {/* Small "G" prefix inside each chip */}
            <span className="text-[9px] font-bold text-sky-400/70">G</span>
            {lbl.name}
          </span>
        ))}
      </div>
    </div>
  )
}
