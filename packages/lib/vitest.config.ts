import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Every test that builds a real vault -- anything going through
    // createFavaLibForTests, plus the CryptoProviders comparison -- runs
    // argon2id at m=64 MiB/t=3/p=4, which is ~260ms by design and is paid
    // again on every unlock and every reload. Vitest runs these files in
    // parallel, so under CPU contention the 5000ms/10000ms defaults sit below
    // the natural worst case rather than above it and the suite flakes. These
    // bounds are here to catch a hang, not to police speed.
    //
    // Left at 30s rather than raised for the two 1,000-command burst tests in
    // sync-command-delivery: those take about 27s of real work now that every
    // command carries a composite signature, and they set their own timeout.
    // Raising it globally would quadruple how long an actual hang takes to
    // surface in the other five hundred tests.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
