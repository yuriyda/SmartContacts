/**
 * @file MobileApp.tsx
 * Top-level shell for the PWA mobile target. Mirrors web/src/SmartContactsApp.tsx structure
 * but renders mobile-friendly screens via react-router-dom HashRouter.
 *
 * Rules:
 *  - Uses HashRouter (Capacitor-safe; no server rewrites).
 *  - Limited scope per spec §22.5: no bulk ops, no multi-select, no undo, no Network dashboard.
 *  - Tap targets ≥ 44px. BottomNav sticky at bottom.
 *  - Do NOT call useCapacitorDb() inside AppProvider — db must be injected as a prop.
 */
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider } from '@smart-contacts/web/ui/AppContext'
import { useCapacitorDb } from '../../store/useCapacitorDb'
import { BottomNav } from './BottomNav'
import { ListScreen } from './screens/ListScreen'
import { DetailScreen } from './screens/DetailScreen'
import { EditScreen } from './screens/EditScreen'
import { SearchScreen } from './screens/SearchScreen'
import { SettingsScreen } from './screens/SettingsScreen'

export function MobileApp() {
  const dbState = useCapacitorDb()
  if (!dbState.db || !dbState.deviceId || !dbState.contactsRepo || !dbState.defsRepo) {
    return <BootSplash />
  }
  return (
    <AppProvider
      db={dbState.db}
      deviceId={dbState.deviceId}
      contactsRepo={dbState.contactsRepo}
      defsRepo={dbState.defsRepo}
    >
      <MobileLayout dbState={dbState} />
    </AppProvider>
  )
}

function BootSplash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100">
      <span className="text-sm">Loading…</span>
    </div>
  )
}

function MobileLayout({ dbState }: { dbState: ReturnType<typeof useCapacitorDb> }) {
  return (
    <HashRouter>
      <div className="min-h-screen flex flex-col bg-slate-900">
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/list" replace />} />
            <Route path="/list" element={<ListScreen dbState={dbState} />} />
            <Route path="/contact/new" element={<EditScreen dbState={dbState} mode="new" />} />
            <Route path="/contact/:id" element={<DetailScreen dbState={dbState} />} />
            <Route
              path="/contact/:id/edit"
              element={<EditScreen dbState={dbState} mode="edit" />}
            />
            <Route path="/search" element={<SearchScreen dbState={dbState} />} />
            <Route path="/settings" element={<SettingsScreen dbState={dbState} />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
    </HashRouter>
  )
}
