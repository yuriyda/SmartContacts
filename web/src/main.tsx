// React entry — mounts SmartContactsApp into #root.
import React from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import { SmartContactsApp } from './SmartContactsApp'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SmartContactsApp />
  </React.StrictMode>,
)
