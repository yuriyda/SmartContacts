/**
 * @file vite.config.ts
 * Vite configuration for the Tauri desktop shell.
 * Resolves workspace packages via pnpm symlinks (no explicit path alias needed
 * for @smart-contacts/shared or @smart-contacts/web — pnpm sets them up in
 * node_modules so Vite finds them automatically and subpath imports work correctly).
 *
 * Port 1420 with strictPort: matches Tauri devUrl in tauri.conf.json.
 * clearScreen: false prevents Tauri CLI from being hidden by Vite output.
 *
 * optimizeDeps.exclude wa-sqlite: prevents Vite pre-bundler from rewriting
 * wa-sqlite.mjs paths (same reason as web/vite.config.ts).
 *
 * Rules: Do not add '@smart-contacts/shared' as an alias — it would break
 *        subpath imports like '@smart-contacts/shared/src/db/wa-sqlite-backend'.
 *        Workspace symlinks handle resolution correctly.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  optimizeDeps: { exclude: ['wa-sqlite'] },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: true,
  },
})
