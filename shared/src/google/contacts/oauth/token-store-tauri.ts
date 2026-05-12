// Platform-agnostic token store abstraction for Google Contacts OAuth refresh tokens.
// The interface is defined here in shared/; the Tauri-specific implementation is in
// tauri/src/store/tauri-token-store.ts which injects the real @tauri-apps/plugin-store adapter.
//
// EDITING RULES:
// - Do NOT import @tauri-apps/* here — this file must remain platform-agnostic (shared/).
// - StorageAdapter is the only seam between shared/ and the Tauri layer.
// - TOKEN_STORE_KEY must not change without migrating existing stored tokens.
// - All comments must remain in English.

// RO-INVARIANT: L7.1

/** Key used to store the Google Contacts refresh token in the secure storage backend. */
export const TOKEN_STORE_KEY = 'smart-contacts.google.contacts.refresh_token' as const

/**
 * Minimal key/value storage adapter interface.
 * Implemented by the Tauri layer using @tauri-apps/plugin-store.
 * Implemented by test doubles using in-memory maps.
 */
export interface StorageAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/** High-level token store operations over a StorageAdapter. */
export interface TokenStore {
  /** Reads the stored refresh token, or null if none exists. */
  read(): Promise<string | null>
  /** Persists a refresh token to secure storage. */
  write(token: string): Promise<void>
  /** Removes the stored refresh token (logout / revoke). */
  clear(): Promise<void>
}

/**
 * Creates a TokenStore backed by the provided StorageAdapter.
 * On the Tauri side, pass the plugin-store adapter; in tests, pass an in-memory mock.
 */
export function makeTauriTokenStore(storage: StorageAdapter): TokenStore {
  return {
    read(): Promise<string | null> {
      return storage.get(TOKEN_STORE_KEY)
    },
    write(token: string): Promise<void> {
      return storage.set(TOKEN_STORE_KEY, token)
    },
    clear(): Promise<void> {
      return storage.delete(TOKEN_STORE_KEY)
    },
  }
}
