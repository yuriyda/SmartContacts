// Tailwind CSS configuration for pwa shell.
// Includes shared/src so themes.ts class strings (gruvbox, custom hex) are not purged.
import type { Config } from 'tailwindcss'
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../shared/src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
