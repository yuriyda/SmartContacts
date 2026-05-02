/**
 * @file main.tsx
 * Tauri desktop entry point. Boots the Smart Contacts React tree.
 *
 * T4: Uses SmartContactsShell with injected Tauri DbAdapter so the desktop
 *     app uses tauri-plugin-sql instead of wa-sqlite (IndexedDB).
 *     wa-sqlite is NOT bundled here — only SmartContactsShell is imported,
 *     which does not transitively pull in useDb or the wa-sqlite backend.
 *
 * Rules: Keep this file as thin as possible — all app logic lives in @smart-contacts/web.
 * Do not add business logic here; only Tauri-specific bootstrap.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SmartContactsShell } from '@smart-contacts/web'
import { useTauriDb } from './store/useTauriDb'
import './app.css'

function TauriApp() {
  const dbState = useTauriDb()
  return <SmartContactsShell dbState={dbState} />
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TauriApp />
  </React.StrictMode>,
)
