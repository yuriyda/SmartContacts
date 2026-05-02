// Vite configuration for the PWA mobile shell.
// Resolves @shared/* to ../shared/src (no build step needed for shared package).
// VitePWA plugin generates service worker and web app manifest.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      // Generate service worker and inject manifest link in dev too —
      // without this, neither <link rel="manifest"> nor sw.js exist on `vite dev`,
      // making PWA-specific behaviour untestable in the dev loop.
      devOptions: { enabled: true },
      manifest: {
        name: 'Smart Contacts',
        short_name: 'Contacts',
        description: 'Decentralized offline-first contact manager',
        theme_color: '#0ea5e9',
        background_color: '#111827',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared/src') } },
  // See web/vite.config.ts: pre-bundling wa-sqlite breaks WASM URL resolution in dev.
  optimizeDeps: { exclude: ['wa-sqlite'] },
  server: { port: 5174 },
  build: {
    // es2020 required by Capacitor 6 runtime (supports top-level await, BigInt, etc.).
    target: 'es2020',
    outDir: 'dist',
  },
})
