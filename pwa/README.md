# Smart Contacts — PWA / Android Shell

Mobile (Android) shell built with Capacitor 6 on top of the shared web UI.

## Android build flow

```sh
# 1. Build the web assets
pnpm --filter @smart-contacts/pwa build       # produces dist/

# 2. One-time scaffold (requires Java JDK 17+ and Android SDK installed on host machine)
npx cap add android

# 3. Sync web assets into the native project
npx cap sync android

# 4. Open Android Studio to build / run on device or emulator
npx cap open android
```

> **Note:** Steps 2–4 must be run on a machine with Java JDK and Android SDK available.
> The container used for web development does not have Java installed — that is expected.

## Capacitor plugins

| Plugin | Purpose |
|---|---|
| `@capacitor-community/sqlite` | Offline-first SQLite storage on Android |
| `@capacitor/local-notifications` | Birthday / follow-up reminders |
| `@capacitor/preferences` | Key-value settings storage |

## Dev server

```sh
pnpm --filter @smart-contacts/pwa dev   # or: pnpm dev:pwa from repo root
```
