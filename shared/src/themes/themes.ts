// Color theme definitions (default + gruvbox) with dark/light variants.
// Ported verbatim from TaskOrchestrator (tauri-app/src/core/themes.ts) — visual parity is intentional.
// buildTC() resolves theme + mode into Tailwind utility class strings.

export const COLOR_THEMES = {
  default: {
    swatches: ['#0ea5e9', '#8b5cf6', '#374151'],
    dark: {
      root: 'bg-gray-900 text-gray-100',
      header: 'border-gray-700/50 bg-gray-900',
      aside: 'border-gray-700/50 bg-gray-900',
      surface: 'bg-gray-800',
      surfaceAlt: 'bg-gray-800/50',
      elevated: 'bg-gray-700',
      borderClass: 'border-gray-700/50',
      input: 'bg-gray-800 border-gray-600',
      inputText: 'text-gray-100 placeholder-gray-500',
      text: 'text-gray-100',
      textSec: 'text-gray-400',
      textMuted: 'text-gray-500',
      hoverBg: 'hover:bg-gray-800',
      taskHoverBg: 'rgba(55,65,81,.25)',
      taskHoverShadow: '0 0 0 1px rgba(107,114,128,.4)',
      scrollTrack: '#111827',
      scrollThumb: '#374151',
      scrollThumbHover: '#4b5563',
    },
    light: {
      root: 'bg-gray-50 text-gray-900',
      header: 'border-gray-200 bg-white',
      aside: 'border-gray-200 bg-white',
      surface: 'bg-white',
      surfaceAlt: 'bg-gray-100/70',
      elevated: 'bg-gray-100',
      borderClass: 'border-gray-200',
      input: 'bg-white border-gray-300',
      inputText: 'text-gray-900 placeholder-gray-400',
      text: 'text-gray-900',
      textSec: 'text-gray-600',
      textMuted: 'text-gray-400',
      hoverBg: 'hover:bg-gray-100',
      taskHoverBg: 'rgba(203,213,225,.4)',
      taskHoverShadow: '0 0 0 1px rgba(100,116,139,.3)',
      scrollTrack: '#f1f5f9',
      scrollThumb: '#cbd5e1',
      scrollThumbHover: '#94a3b8',
    },
  },
  gruvbox: {
    swatches: ['#d79921', '#98971a', '#282828'],
    dark: {
      root: 'bg-[#282828] text-[#ebdbb2]',
      header: 'border-[#504945] bg-[#282828]',
      aside: 'border-[#504945] bg-[#282828]',
      surface: 'bg-[#3c3836]',
      surfaceAlt: 'bg-[#3c3836]/50',
      elevated: 'bg-[#504945]',
      borderClass: 'border-[#504945]',
      input: 'bg-[#3c3836] border-[#504945]',
      inputText: 'text-[#ebdbb2] placeholder-[#928374]',
      text: 'text-[#ebdbb2]',
      textSec: 'text-[#d5c4a1]',
      textMuted: 'text-[#928374]',
      hoverBg: 'hover:bg-[#3c3836]',
      taskHoverBg: 'rgba(60,56,54,.5)',
      taskHoverShadow: '0 0 0 1px rgba(80,73,69,.7)',
      scrollTrack: '#1d2021',
      scrollThumb: '#504945',
      scrollThumbHover: '#665c54',
    },
    light: {
      root: 'bg-[#fbf1c7] text-[#3c3836]',
      header: 'border-[#d5c4a1] bg-[#fbf1c7]',
      aside: 'border-[#d5c4a1] bg-[#fbf1c7]',
      surface: 'bg-[#ebdbb2]',
      surfaceAlt: 'bg-[#ebdbb2]/70',
      elevated: 'bg-[#d5c4a1]',
      borderClass: 'border-[#d5c4a1]',
      input: 'bg-[#ebdbb2] border-[#d5c4a1]',
      inputText: 'text-[#3c3836] placeholder-[#928374]',
      text: 'text-[#3c3836]',
      textSec: 'text-[#504945]',
      textMuted: 'text-[#928374]',
      hoverBg: 'hover:bg-[#d5c4a1]',
      taskHoverBg: 'rgba(213,196,161,.5)',
      taskHoverShadow: '0 0 0 1px rgba(168,153,132,.5)',
      scrollTrack: '#ebdbb2',
      scrollThumb: '#d5c4a1',
      scrollThumbHover: '#bdae93',
    },
  },
} as const

export interface ThemeClasses {
  root: string
  header: string
  aside: string
  surface: string
  surfaceAlt: string
  elevated: string
  borderClass: string
  input: string
  inputText: string
  text: string
  textSec: string
  textMuted: string
  hoverBg: string
  taskHoverBg: string
  taskHoverShadow: string
  scrollTrack: string
  scrollThumb: string
  scrollThumbHover: string
}
export type ColorTheme = keyof typeof COLOR_THEMES
export type ThemeMode = 'light' | 'dark'

export function buildTC(
  resolvedTheme: ThemeMode,
  colorTheme: ColorTheme = 'default',
): ThemeClasses {
  const theme = COLOR_THEMES[colorTheme] ?? COLOR_THEMES.default
  return resolvedTheme === 'light' ? theme.light : theme.dark
}
