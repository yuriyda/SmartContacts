// English dictionary for the Smart Contacts shell UIs.
// Extend the keys here first, then mirror them in ru.ts (TS will surface gaps via the `Dict` type).

export const en = {
  app: { title: 'Smart Contacts' },
  status: { contacts: '{count} contacts' },
  theme: { light: 'Light', dark: 'Dark' },
  density: { compact: 'Compact', comfortable: 'Comfortable' },
  settings: { title: 'Settings', tabs: { general: 'General', about: 'About' } },
}
export type Dict = typeof en
