// React entry — mounts MobileApp into #root.
import React from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import { MobileApp } from './MobileApp'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MobileApp />
  </React.StrictMode>,
)
