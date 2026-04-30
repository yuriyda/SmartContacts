// App-level context: locale, theme/mode, density — all persisted to the meta table.
// Rules: db is injected as a prop by SmartContactsApp after useDb resolves;
// do not import DB-opening logic here. Only React primitives and @smart-contacts/shared types.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  i18n,
  themes,
  type ContactsRepo,
  type CustomFieldDefsRepo,
  type DbAdapter,
} from '@smart-contacts/shared'

type Locale = 'en' | 'ru'
type ColorTheme = 'default' | 'gruvbox'
type ThemeMode = 'dark' | 'light'
type Density = 'compact' | 'comfortable'

export interface AppContextValue {
  t: (key: string, vars?: Record<string, string | number>) => string
  locale: Locale
  setLocale: (l: Locale) => void
  theme: ColorTheme
  setTheme: (t: ColorTheme) => void
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
  density: Density
  setDensity: (d: Density) => void
  TC: themes.ThemeClasses
  metaSettings: Record<string, string>
  saveMeta: (key: string, value: string) => Promise<void>
  // Singleton DB handles. NEVER call useDb() in a child component — that
  // would open a second wa-sqlite adapter with its own in-memory page cache,
  // and writes from the child would not be visible to the parent (and vice
  // versa). Always read these from useApp().
  db: DbAdapter | null
  deviceId: string | null
  contactsRepo: ContactsRepo | null
  defsRepo: CustomFieldDefsRepo | null
}

const Ctx = createContext<AppContextValue | null>(null)

interface AppProviderProps {
  children: ReactNode
  db: DbAdapter | null
  deviceId: string | null
  contactsRepo: ContactsRepo | null
  defsRepo: CustomFieldDefsRepo | null
}

export function AppProvider({ children, db, deviceId, contactsRepo, defsRepo }: AppProviderProps) {
  // Local React state defaults; overridden by meta on first DB read.
  const [locale, setLocaleState] = useState<Locale>('en')
  const [theme, setThemeState] = useState<ColorTheme>('default')
  const [mode, setModeState] = useState<ThemeMode>('dark')
  const [density, setDensityState] = useState<Density>('comfortable')
  const [metaSettings, setMetaSettings] = useState<Record<string, string>>({})

  // Read meta on db ready.
  useEffect(() => {
    if (!db) return
    let cancelled = false
    void (async () => {
      const rows = await db.select<{ key: string; value: string }>('SELECT key, value FROM meta')
      if (cancelled) return
      const dict: Record<string, string> = {}
      for (const r of rows) dict[r.key] = r.value
      setMetaSettings(dict)
      if (dict.locale === 'en' || dict.locale === 'ru') setLocaleState(dict.locale)
      if (dict.theme === 'default' || dict.theme === 'gruvbox') setThemeState(dict.theme)
      if (dict.mode === 'dark' || dict.mode === 'light') setModeState(dict.mode)
      if (dict.density === 'compact' || dict.density === 'comfortable')
        setDensityState(dict.density)
    })()
    return () => {
      cancelled = true
    }
  }, [db])

  const saveMeta = useCallback(
    async (key: string, value: string) => {
      if (!db) return
      await db.execute(
        `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value],
      )
      setMetaSettings((prev) => ({ ...prev, [key]: value }))
    },
    [db],
  )

  const setLocale = useCallback(
    (l: Locale) => {
      setLocaleState(l)
      void saveMeta('locale', l)
    },
    [saveMeta],
  )
  const setTheme = useCallback(
    (t: ColorTheme) => {
      setThemeState(t)
      void saveMeta('theme', t)
    },
    [saveMeta],
  )
  const setMode = useCallback(
    (m: ThemeMode) => {
      setModeState(m)
      void saveMeta('mode', m)
    },
    [saveMeta],
  )
  const setDensity = useCallback(
    (d: Density) => {
      setDensityState(d)
      void saveMeta('density', d)
    },
    [saveMeta],
  )

  const TC = useMemo(() => themes.COLOR_THEMES[theme][mode], [theme, mode])
  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => i18n.t(locale, key, vars),
    [locale],
  )

  const value = useMemo<AppContextValue>(
    () => ({
      t,
      locale,
      setLocale,
      theme,
      setTheme,
      mode,
      setMode,
      density,
      setDensity,
      TC,
      metaSettings,
      saveMeta,
      db,
      deviceId,
      contactsRepo,
      defsRepo,
    }),
    [
      t,
      locale,
      setLocale,
      theme,
      setTheme,
      mode,
      setMode,
      density,
      setDensity,
      TC,
      metaSettings,
      saveMeta,
      db,
      deviceId,
      contactsRepo,
      defsRepo,
    ],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
