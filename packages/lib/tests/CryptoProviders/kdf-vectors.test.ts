import { describe, expect, test } from 'vitest'
import { argon2id } from 'hash-wasm'
import { uint8ArrayToBase64 } from 'uint8array-extras'

import type { Password, Salt } from '../../src/main.mjs'
import { generatePasswordHash } from '../../src/platformProviders/browser/cryptoLib.mjs'
import { nodeProviders } from '../../src/platformProviders/node/index.mjs'
import { browserProviders } from '../../src/platformProviders/browser/index.mjs'

// Test vectors for the argon2id layer of the key hierarchy. See
// key-hierarchy-review/06-crypto-test-coverage.md: without these, changing a
// KDF parameter breaks every existing vault with a fully green suite, because
// every other crypto test only asserts that we agree with ourselves.
//
// Both expected values below were produced by hash-wasm AND independently
// reproduced with the reference P-H-C implementation (libargon2), which agreed
// byte for byte. That is what makes them vectors rather than a recording of our
// own output. To re-verify without trusting this file (-m 9 is log2 of 512 KiB,
// and argon2 reads the password from stdin):
//
//   printf '%s' 'fixture!Vault7#Frozen$v1' | nix shell nixpkgs#libargon2 -c \
//     argon2 'O454a0A723g+U3MYcYoCFA==' -id -t 256 -m 9 -p 1 -l 64 -r
//
//   printf '%s' 'fixture!Vault7#Frozen$v1' | nix shell nixpkgs#libargon2 -c \
//     argon2 'O454a0A723g+U3MYcYoCFA==' -id -t 3 -m 16 -p 4 -l 64 -r
//
//   printf '\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f\x20' \
//     | nix shell nixpkgs#libargon2 -c \
//     argon2 '91b8a8bf-3450-4e68-94db-4d6051901ffa' -id -t 256 -m 9 -p 1 -l 32 -r
//
// No `globalThis.window` shim here, unlike the other files in this directory:
// argon2id and createSyncKey never touch window.crypto, and neither provider's
// index module does either.

/**
 * The argon2id cost parameters createSyncKey derives with, spelled out rather
 * than imported, so that editing the shipped values cannot silently move them.
 *
 * Storage version 1 derived passwords with these too. That read path is gone,
 * but the parameters are not: SYNC_KDF_PARAMETERS still uses them, where the
 * cost is immaterial because the input is already a 256-bit shared secret.
 */
const SYNC_PARAMETERS = {
  parallelism: 1,
  iterations: 256,
  memorySize: 512,
} as const

/**
 * The password parameters, likewise spelled out. m = 64 MiB, t = 3, p = 4 --
 * key-hierarchy-review/01-kdf-parameters.md. memorySize is in KiB.
 */
const V2_PARAMETERS = {
  parallelism: 4,
  iterations: 3,
  memorySize: 65536,
} as const

// Deliberately the password and salt of tests/fixtures/vault-v1.json. That
// vault is no longer readable, but keeping the inputs identical is what lets
// these vectors be compared against every hash recorded elsewhere in the suite
// -- the envelope-mac chain anchor among them.
const FIXTURE_PASSWORD = 'fixture!Vault7#Frozen$v1' as Password
const FIXTURE_SALT = 'O454a0A723g+U3MYcYoCFA==' as Salt
const EXPECTED_SYNC_PASSWORD_HASH =
  'bd9c01dab08f03a906c7fd2c155bf14e8e2706d04f0afe8e7afa54508b7526447feb04fb14cf98dc6810e443bf8674d17cc65bf2d65ed7498ec2b9ec4974a0bd'
// Same password and salt as the vector above, so the only thing that differs
// between the two is the cost parameters.
const EXPECTED_V2_PASSWORD_HASH =
  '7b6da4164545def5fabbf2e0ed003074b9d692877a3a6de7d92531e20dd2606be63be1c2354d7e1d763b2f0e1e8b0c26de829ef47593e71c056dd071aa999f79'

// createSyncKey is handed a device id as its salt (SyncManager.mts:664,696) and
// a jpake-derived shared secret as its password, so the vector uses that shape.
const SHARED_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const SYNC_SALT = '91b8a8bf-3450-4e68-94db-4d6051901ffa' as Salt
const EXPECTED_SYNC_KEY = 'gqxjkuuaiZSdrIoaNUJ3QiDoNPsqkg8mVBglfvkBm2s='

describe('argon2id test vectors', () => {
  describe('password hash (generatePasswordHash)', () => {
    // The permanent anchor for the cheap parameters. Nothing derives a
    // PASSWORD with them any more -- 01-kdf-parameters.md moved vaults to the
    // stronger set and the old read path is gone -- but createSyncKey still
    // derives with exactly these numbers, and this vector is what catches a
    // hash-wasm upgrade that changes behaviour under fixed inputs.
    test('the sync parameters produce the known hash', async () => {
      const hash = await argon2id({
        password: FIXTURE_PASSWORD,
        salt: FIXTURE_SALT,
        ...SYNC_PARAMETERS,
        hashLength: 64,
        outputType: 'hex',
      })

      expect(hash).toBe(EXPECTED_SYNC_PASSWORD_HASH)
    })

    // The password anchor, on the same footing: an absolute value, reproduced
    // independently, that every stored vault depends on.
    test('v2 parameters produce the known hash', async () => {
      const hash = await argon2id({
        password: FIXTURE_PASSWORD,
        salt: FIXTURE_SALT,
        ...V2_PARAMETERS,
        hashLength: 64,
        outputType: 'hex',
      })

      expect(hash).toBe(EXPECTED_V2_PASSWORD_HASH)
    })

    // The policy assertion. This is the test that goes red the moment someone
    // edits `iterations`, `memorySize` or `parallelism` in
    // browser/cryptoLib.mts -- which is the entire point of the finding.
    //
    // Whoever raises the parameters again must move THIS assertion
    // consciously, to a v3 vector, and leave both anchors above in place: a
    // vault records the parameters it was written with, and must still open.
    // Both providers run this exact function: node/cryptoLib.mts imports it
    // from the browser one, so there is only one implementation.
    test('the shipped parameters are the v2 parameters', async () => {
      const hash = await generatePasswordHash(FIXTURE_SALT, FIXTURE_PASSWORD)

      expect(hash).toBe(EXPECTED_V2_PASSWORD_HASH)
    })

    // ...and a vault's own recorded parameters are still honoured, rather than
    // the shipped default being applied to everything. generatePasswordHash
    // defaults to the password set; the load path passes the stored kdf block.
    test('explicit parameters override the shipped default', async () => {
      const hash = await generatePasswordHash(FIXTURE_SALT, FIXTURE_PASSWORD, {
        algorithm: 'argon2id',
        ...SYNC_PARAMETERS,
        hashLength: 64,
      })

      expect(hash).toBe(EXPECTED_SYNC_PASSWORD_HASH)
    })
  })

  describe('sync key (createSyncKey)', () => {
    test('the sync parameters produce the known sync key', async () => {
      const key = await argon2id({
        password: SHARED_KEY,
        salt: SYNC_SALT,
        ...SYNC_PARAMETERS,
        hashLength: 32,
        outputType: 'binary',
      })

      expect(uint8ArrayToBase64(key)).toBe(EXPECTED_SYNC_KEY)
    })

    // Unlike generatePasswordHash, createSyncKey is genuinely implemented twice
    // -- once per provider -- so both need pinning against an absolute value.
    // 'Node and Browser createSyncKey produce the same result' in
    // compare-node-browser.test.ts stays green if both are changed together;
    // these two do not.
    test.each([
      ['NodeCryptoLib', nodeProviders],
      ['BrowserCryptoLib', browserProviders],
    ])('%s createSyncKey matches the vector', async (_name, providers) => {
      const crypto = new providers.CryptoLib()

      const syncKey = await crypto.createSyncKey(SHARED_KEY, SYNC_SALT)

      expect(syncKey).toBe(EXPECTED_SYNC_KEY)
    })
  })
})
