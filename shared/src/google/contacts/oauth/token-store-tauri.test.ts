// Tests for the TokenStore abstraction backed by a mock StorageAdapter.
// Verifies the write→read and clear→read contract without any Tauri dependency.

import { describe, it, expect, beforeEach } from 'vitest'
import { makeTauriTokenStore, StorageAdapter, TOKEN_STORE_KEY } from './token-store-tauri'

function makeMockAdapter(): StorageAdapter & { _data: Map<string, string> } {
  const _data = new Map<string, string>()
  return {
    _data,
    async get(key: string): Promise<string | null> {
      return _data.get(key) ?? null
    },
    async set(key: string, value: string): Promise<void> {
      _data.set(key, value)
    },
    async delete(key: string): Promise<void> {
      _data.delete(key)
    },
  }
}

describe('makeTauriTokenStore', () => {
  let adapter: ReturnType<typeof makeMockAdapter>

  beforeEach(() => {
    adapter = makeMockAdapter()
  })

  it('read returns null when nothing has been written', async () => {
    const store = makeTauriTokenStore(adapter)
    expect(await store.read()).toBeNull()
  })

  it('write then read returns the same token', async () => {
    const store = makeTauriTokenStore(adapter)
    await store.write('test-refresh-token-abc')
    expect(await store.read()).toBe('test-refresh-token-abc')
  })

  it('write stores under the correct key', async () => {
    const store = makeTauriTokenStore(adapter)
    await store.write('token-xyz')
    expect(adapter._data.get(TOKEN_STORE_KEY)).toBe('token-xyz')
  })

  it('clear then read returns null', async () => {
    const store = makeTauriTokenStore(adapter)
    await store.write('token-to-clear')
    await store.clear()
    expect(await store.read()).toBeNull()
  })
})
