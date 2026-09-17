import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // These regressions use real Argon2 and RSA operations on frozen vaults.
    testTimeout: 30_000,
  },
})
