import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: './test/global-setup.mts',
    // Run all test files in a single worker so they don't hit the test
    // database concurrently (vitest 4 replacement for poolOptions.forks.singleFork).
    fileParallelism: false,
  },
})
