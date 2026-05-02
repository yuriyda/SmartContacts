/**
 * @file tailwind.config.ts
 * Tailwind CSS configuration for the Tauri desktop shell.
 * Content paths include web/src so all web component classes survive purging.
 * shared/src is included so theme class strings (gruvbox, custom hex) are not purged.
 */
import type { Config } from 'tailwindcss'
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../web/src/**/*.{ts,tsx}',
    '../shared/src/**/*.{ts,tsx}',
  ],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
