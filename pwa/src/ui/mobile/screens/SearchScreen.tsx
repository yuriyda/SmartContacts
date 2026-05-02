/**
 * @file SearchScreen.tsx
 * STUB — populated in P11.T5. Will render full-text contact search UI.
 *
 * Rules:
 *  - No multi-select, no bulk ops (spec §22.5).
 *  - Touch-friendly: tap targets ≥ 44px.
 */
import type { DbState } from '@smart-contacts/web'

export function SearchScreen({ dbState }: { dbState: DbState }) {
  void dbState
  return <div className="h-full flex items-center justify-center text-slate-300">Search (T5)</div>
}
