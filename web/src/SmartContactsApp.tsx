// Top-level shell: header + Sidebar + MainList + StatusBar, themed.
// Rules: AppProvider must wrap Inner; useDb lives in Inner so context is available.
import { AppProvider, useApp } from './ui/AppContext'
import { Sidebar } from './ui/Sidebar'
import { MainList } from './ui/MainList'
import { StatusBar } from './ui/StatusBar'
import { useDb } from './store/useDb'
import { themes } from '@smart-contacts/shared'

function Inner() {
  const { theme, mode } = useApp()
  const tc = themes.COLOR_THEMES[theme][mode]
  const { db } = useDb()
  return (
    <div className={`h-full flex flex-col ${tc.root}`}>
      <header className={`flex items-center px-4 h-12 border-b ${tc.borderClass} ${tc.header}`}>
        <h1 className="text-lg font-semibold">Smart Contacts</h1>
      </header>
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <MainList db={db} />
      </div>
      <StatusBar db={db} />
    </div>
  )
}

export function SmartContactsApp() {
  return (
    <AppProvider>
      <Inner />
    </AppProvider>
  )
}
