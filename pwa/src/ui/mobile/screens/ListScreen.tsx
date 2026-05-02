/**
 * @file ListScreen.tsx
 * STUB — populated in P11.T4. Will render the full contact list with FAB add button.
 *
 * Rules:
 *  - No bulk operations, no multi-select (spec §22.5).
 *  - Touch-friendly: tap targets ≥ 44px.
 */
import type { DbState } from '@smart-contacts/web'

export function ListScreen({ dbState }: { dbState: DbState }) {
  void dbState
  return <div className="h-full flex items-center justify-center text-slate-300">List (T4)</div>
}
