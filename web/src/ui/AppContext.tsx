// App-level context: locale, theme/mode, density. Pure UI state, no DB.
// Rules: keep this file free of DB imports; only React primitives and types.
import { createContext, useContext, useMemo, useState, ReactNode } from 'react'

type Locale = 'en' | 'ru'

interface AppCtx {
  locale: Locale
  setLocale: (l: Locale) => void
  mode: 'dark' | 'light'
  setMode: (m: 'dark' | 'light') => void
  theme: 'default' | 'gruvbox'
  setTheme: (t: 'default' | 'gruvbox') => void
  density: 'compact' | 'comfortable'
  setDensity: (d: 'compact' | 'comfortable') => void
}

const Ctx = createContext<AppCtx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('ru')
  const [mode, setMode] = useState<'dark' | 'light'>('dark')
  const [theme, setTheme] = useState<'default' | 'gruvbox'>('default')
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable')
  const value = useMemo(
    () => ({ locale, setLocale, mode, setMode, theme, setTheme, density, setDensity }),
    [locale, mode, theme, density],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
