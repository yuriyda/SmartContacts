/**
 * @file BottomNav.tsx
 * Sticky bottom navigation: Contacts (list) / Search / Settings.
 * Tap targets are 56px tall (h-14); uses NavLink active style for current route.
 *
 * Rules:
 *  - No business logic here — routing only.
 *  - i18n labels are hardcoded English for T3; T5 will replace with t() calls.
 *  - Tap target height enforced by h-14 (56px) on nav element.
 */
import { NavLink } from 'react-router-dom'
import { Users, Search, Settings as SettingsIcon } from 'lucide-react'

const ITEMS = [
  { to: '/list', label: 'Contacts', icon: Users },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
] as const

export function BottomNav() {
  return (
    <nav className="flex border-t border-slate-700 bg-slate-800 h-14 flex-shrink-0">
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center text-xs ${
              isActive ? 'text-sky-400' : 'text-slate-400'
            }`
          }
        >
          <Icon size={20} />
          <span className="mt-0.5">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
