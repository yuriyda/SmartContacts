/**
 * @file main.tsx
 * React entry — mounts MobileApp into #root.
 *
 * Rules:
 *  - Keep this file thin; no business logic.
 *  - Do NOT inline db init here — delegate to useCapacitorDb inside MobileApp.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import { MobileApp } from './ui/mobile/MobileApp'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
)
