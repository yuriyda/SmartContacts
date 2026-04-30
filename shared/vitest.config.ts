// Vitest configuration for @smart-contacts/shared.
// Uses jsdom environment and fake-indexeddb setup to simulate browser APIs in tests.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**'] },
  },
})
