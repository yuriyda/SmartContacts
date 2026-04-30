// Vite configuration for the web shell.
// Resolves @shared/* to ../shared/src so TypeScript source is consumed directly (no build step).
//
// `optimizeDeps.exclude: ['wa-sqlite']`: prevents Vite's dep pre-bundling from
// rewriting wa-sqlite.mjs paths in dev. Without this, the bundled module asks
// for `wa-sqlite.wasm` at a URL that Vite SPA-fallbacks to index.html, leading
// to "expected magic word 00 61 73 6d, found 3c 21 64 6f" (HTML, not WASM).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../shared/src') },
  },
  optimizeDeps: { exclude: ['wa-sqlite'] },
  server: { port: 5173 },
})
