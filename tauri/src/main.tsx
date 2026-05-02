/**
 * @file main.tsx
 * Tauri desktop entry point. Boots the Smart Contacts React tree.
 * In T3 this will be replaced to inject a Tauri-backed DbAdapter via SmartContactsShell
 * so the desktop app uses tauri-plugin-sql instead of wa-sqlite (IndexedDB).
 *
 * Rules: Keep this file as thin as possible — all app logic lives in @smart-contacts/web.
 * Do not add business logic here; only Tauri-specific bootstrap (T3+T4).
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SmartContactsApp } from '@smart-contacts/web'
import './app.css'

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SmartContactsApp />
  </React.StrictMode>,
)
