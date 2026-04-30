// Vite configuration for the web shell.
// Resolves @shared/* to ../shared/src so TypeScript source is consumed directly (no build step).
//
// `optimizeDeps.exclude: ['wa-sqlite']`: prevents Vite's dep pre-bundling from
// rewriting wa-sqlite.mjs paths in dev. Without this, the bundled module asks
// for `wa-sqlite.wasm` at a URL that Vite SPA-fallbacks to index.html, leading
// to "expected magic word 00 61 73 6d, found 3c 21 64 6f" (HTML, not WASM).
//
// `define.VITE_APP_VERSION`: injects package.json version into import.meta.env.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../shared/src') },
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  optimizeDeps: { exclude: ['wa-sqlite'] },
  server: { port: 5173 },
})
