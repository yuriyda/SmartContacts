/**
 * @file SettingsScreen.tsx
 * STUB — populated in P11.T5. Will render app settings (locale, theme, backup/restore).
 *
 * Rules:
 *  - No Network dashboard, no Hidden scope (spec §22.5).
 *  - Touch-friendly: tap targets ≥ 44px.
 */
import type { DbState } from '@smart-contacts/web'

export function SettingsScreen({ dbState }: { dbState: DbState }) {
  void dbState
  return <div className="h-full flex items-center justify-center text-slate-300">Settings (T5)</div>
}
