/**
 * @file main.tsx
 * React entry — mounts PwaApp into #root.
 *
 * T2 milestone: verify Capacitor DbAdapter works by mounting the desktop shell.
 * T3 will replace PwaApp with MobileApp + HashRouter + BottomNav.
 *
 * Rules:
 *  - Keep this file thin; no business logic.
 *  - Do NOT inline db init here — delegate to useCapacitorDb.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import { SmartContactsShell } from '@smart-contacts/web'
import { useCapacitorDb } from './store/useCapacitorDb'
import './app.css'

// T2 milestone: verify Capacitor DbAdapter works by mounting the desktop shell.
// T3 will replace this entry with MobileApp + HashRouter + BottomNav.
function PwaApp() {
  const dbState = useCapacitorDb()
  return <SmartContactsShell dbState={dbState} />
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PwaApp />
  </React.StrictMode>,
)
