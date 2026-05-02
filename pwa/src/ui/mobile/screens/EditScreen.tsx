/**
 * @file EditScreen.tsx
 * STUB — populated in P11.T4. Will render contact create/edit form.
 *
 * Rules:
 *  - mode='new' renders empty form; mode='edit' loads existing contact by :id param.
 *  - No bulk operations (spec §22.5).
 *  - Touch-friendly: tap targets ≥ 44px.
 */
import type { DbState } from '@smart-contacts/web'

interface EditScreenProps {
  dbState: DbState
  mode: 'new' | 'edit'
}

export function EditScreen({ dbState, mode }: EditScreenProps) {
  void dbState
  return (
    <div className="h-full flex items-center justify-center text-slate-300">Edit ({mode}) (T4)</div>
  )
}
