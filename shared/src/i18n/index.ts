// Minimal i18n surface. Subsequent plans extend the dictionaries; this file's
// API (locale type, `dictionaries`, `t()`) stays stable.

import { en } from './en'
import { ru } from './ru'

export type Locale = 'en' | 'ru'
export const dictionaries = { en, ru }

/** Resolve a dotted key path against the locale dictionary, optionally substituting `{var}` tokens. */
export function t(loc: Locale, path: string, vars?: Record<string, string | number>): string {
  const parts = path.split('.')
  let cur: unknown = dictionaries[loc]
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return path
    }
  }
  let s = typeof cur === 'string' ? cur : path
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  return s
}
