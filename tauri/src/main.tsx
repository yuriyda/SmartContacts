/**
 * @file main.tsx
 * Tauri desktop entry point. Boots the Smart Contacts React tree.
 *
 * T4: Uses SmartContactsShell with injected Tauri DbAdapter so the desktop
 *     app uses tauri-plugin-sql instead of wa-sqlite (IndexedDB).
 *     wa-sqlite is NOT bundled here — only SmartContactsShell is imported,
 *     which does not transitively pull in useDb or the wa-sqlite backend.
 *
 * T5: Attaches window.__SMART_CONTACTS_NATIVE__ so BackupTab can use native
 *     file dialogs without a direct @tauri-apps/* import in web/.
 *     Listens to "smart-contacts:menu" events from the Rust native menu and
 *     forwards them as DOM CustomEvents for SmartContactsApp to handle.
 *
 * Rules: Keep this file as thin as possible — all app logic lives in @smart-contacts/web.
 * Do not add business logic here; only Tauri-specific bootstrap.
 */
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { listen } from '@tauri-apps/api/event'
import { SmartContactsShell } from '@smart-contacts/web'
import { useTauriDb } from './store/useTauriDb'
import { pickSaveLocation, writeTextToFile, pickAndReadJsonFile } from './native-bridge'
import './app.css'

// Expose native bridge functions so web/BackupTab can use them without
// importing @tauri-apps/* directly (avoids cross-package dep from web/).
declare global {
  interface Window {
    __SMART_CONTACTS_NATIVE__?: {
      pickSaveLocation: typeof pickSaveLocation
      writeTextToFile: typeof writeTextToFile
      pickAndReadJsonFile: typeof pickAndReadJsonFile
    }
  }
}

window.__SMART_CONTACTS_NATIVE__ = { pickSaveLocation, writeTextToFile, pickAndReadJsonFile }

function TauriApp() {
  const dbState = useTauriDb()

  // Forward native menu events to the DOM so SmartContactsApp can wire them
  // to undo/redo and backup handlers without knowing about Tauri APIs.
  useEffect(() => {
    const unsub = listen<string>('smart-contacts:menu', (e) => {
      const id = e.payload
      window.dispatchEvent(new CustomEvent('smart-contacts:menu-action', { detail: id }))
    })
    return () => {
      void unsub.then((fn) => fn())
    }
  }, [])

  return <SmartContactsShell dbState={dbState} />
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TauriApp />
  </React.StrictMode>,
)
