import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Every test that builds a real vault -- anything going through
    // createFavaLibForTests, plus the CryptoProviders comparison -- generates a
    // 4096-bit RSA key pair and runs argon2id. That costs ~1s on an idle
    // machine, and RSA prime search is random: the same keygen measured 96ms to
    // 1776ms across ten idle runs. Vitest runs these files in parallel, so
    // under CPU contention the 5000ms/10000ms defaults sit below the natural
    // worst case rather than above it and the suite flakes. These bounds are
    // here to catch a hang, not to police speed.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
