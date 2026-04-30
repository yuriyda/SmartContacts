// Russian dictionary. Shape MUST match the `Dict` type from en.ts.

import type { Dict } from './en'

export const ru: Dict = {
  app: { title: 'Smart Contacts' },
  status: { contacts: '{count} контактов' },
  theme: { light: 'Светлая', dark: 'Тёмная' },
  density: { compact: 'Плотно', comfortable: 'Свободно' },
  settings: { title: 'Настройки', tabs: { general: 'Общее', about: 'О программе' } },
}
