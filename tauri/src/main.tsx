/**
 * @file main.tsx
 * Tauri desktop entry point. Boots the Smart Contacts React tree.
 *
 * T3: tauri-sql-backend + useTauriDb are implemented and compile here.
 *     SmartContactsApp (wa-sqlite) is kept so the dev UX remains functional
 *     in browser preview while the native build path is being wired.
 * T4: swap SmartContactsApp for SmartContactsShell with injected Tauri DbAdapter
 *     so the desktop app uses tauri-plugin-sql instead of wa-sqlite (IndexedDB).
 *
 * Rules: Keep this file as thin as possible — all app logic lives in @smart-contacts/web.
 * Do not add business logic here; only Tauri-specific bootstrap (T3+T4).
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SmartContactsApp } from '@smart-contacts/web'
import './app.css'

// T4 will swap this for SmartContactsShell with injected Tauri DbAdapter.
// For T3 we keep SmartContactsApp (which uses useDb → wa-sqlite) so the dev UX
// remains functional in browser preview while the native build path is being wired.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SmartContactsApp />
  </React.StrictMode>,
)
