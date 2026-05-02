// Capacitor configuration for the Smart Contacts Android shell.
// This file is consumed by @capacitor/cli during `cap sync` and `cap add android`.
// Do NOT add iOS-specific config here — this iteration targets Android only.
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.smart_contacts.app',
  appName: 'Smart Contacts',
  webDir: 'dist',
  android: {
    backgroundColor: '#0f172a',
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
    },
  },
}

export default config
