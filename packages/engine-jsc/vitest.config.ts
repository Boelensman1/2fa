import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The integration tests run real argon2id passes (64 MiB) and, when a sync
    // server is configured, a pairing round trip. These bounds catch hangs.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One bundle build is shared through globalSetup.
    globalSetup: ['./tests/global-setup.mts'],
  },
})
