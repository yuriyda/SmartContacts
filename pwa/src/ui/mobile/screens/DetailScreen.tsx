/**
 * @file DetailScreen.tsx
 * STUB — populated in P11.T4. Will render single-contact detail view.
 *
 * Rules:
 *  - No bulk operations (spec §22.5).
 *  - Touch-friendly: tap targets ≥ 44px.
 */
import type { DbState } from '@smart-contacts/web'

export function DetailScreen({ dbState }: { dbState: DbState }) {
  void dbState
  return <div className="h-full flex items-center justify-center text-slate-300">Detail (T4)</div>
}
