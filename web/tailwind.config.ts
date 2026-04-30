// Tailwind CSS configuration for web shell.
// Content paths cover index.html, web src TS/TSX files, AND shared theme files
// (themes.ts holds dynamically-composed Tailwind class strings — without
// scanning it, gruvbox and custom-hex classes get purged from production CSS).
import type { Config } from 'tailwindcss'
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../shared/src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
