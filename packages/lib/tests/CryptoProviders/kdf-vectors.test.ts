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
//   printf '\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f\x20' \
//     | nix shell nixpkgs#libargon2 -c \
//     argon2 '91b8a8bf-3450-4e68-94db-4d6051901ffa' -id -t 256 -m 9 -p 1 -l 32 -r
//
// No `globalThis.window` shim here, unlike the other files in this directory:
// argon2id and createSyncKey never touch window.crypto, and neither provider's
// index module does either.

/**
 * The storage-version-1 argon2id cost parameters, spelled out rather than
 * imported, so that editing the shipped values cannot silently move them.
 */
const V1_PARAMETERS = {
  parallelism: 1,
  iterations: 256,
  memorySize: 512,
} as const

// Deliberately the password and salt of tests/fixtures/vault-v1.json, so this
// vector isolates the argon2 step of the fixture vault the suite already opens:
// when both go red, this one says which layer moved.
const FIXTURE_PASSWORD = 'fixture!Vault7#Frozen$v1' as Password
const FIXTURE_SALT = 'O454a0A723g+U3MYcYoCFA==' as Salt
const EXPECTED_PASSWORD_HASH =
  'bd9c01dab08f03a906c7fd2c155bf14e8e2706d04f0afe8e7afa54508b7526447feb04fb14cf98dc6810e443bf8674d17cc65bf2d65ed7498ec2b9ec4974a0bd'

// createSyncKey is handed a device id as its salt (SyncManager.mts:664,696) and
// a jpake-derived shared secret as its password, so the vector uses that shape.
const SHARED_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const SYNC_SALT = '91b8a8bf-3450-4e68-94db-4d6051901ffa' as Salt
const EXPECTED_SYNC_KEY = 'gqxjkuuaiZSdrIoaNUJ3QiDoNPsqkg8mVBglfvkBm2s='

describe('argon2id test vectors', () => {
  describe('password hash (generatePasswordHash)', () => {
    // The permanent anchor. Even after 01-kdf-parameters.md moves new vaults to
    // stronger parameters, THESE parameters must keep producing THIS hash, or
    // no vault written before that change can be opened again. It also catches
    // a hash-wasm upgrade that changes behaviour under fixed inputs.
    test('v1 parameters produce the known hash', async () => {
      const hash = await argon2id({
        password: FIXTURE_PASSWORD,
        salt: FIXTURE_SALT,
        ...V1_PARAMETERS,
        hashLength: 64,
        outputType: 'hex',
      })

      expect(hash).toBe(EXPECTED_PASSWORD_HASH)
    })

    // The policy assertion: the parameters we actually ship are still the v1
    // ones. This is the test that goes red the moment someone edits
    // `iterations`, `memorySize` or `parallelism` in browser/cryptoLib.mts --
    // which is the entire point of the finding.
    //
    // Whoever lands 01-kdf-parameters.md must move THIS assertion consciously,
    // to a v2 vector, and leave the v1 anchor above in place for the migration
    // path. Both providers run this exact function: node/cryptoLib.mts:31
    // imports it from the browser one, so there is only one implementation.
    test('the shipped parameters are still the v1 parameters', async () => {
      const hash = await generatePasswordHash(FIXTURE_SALT, FIXTURE_PASSWORD)

      expect(hash).toBe(EXPECTED_PASSWORD_HASH)
    })
  })

  describe('sync key (createSyncKey)', () => {
    test('v1 parameters produce the known sync key', async () => {
      const key = await argon2id({
        password: SHARED_KEY,
        salt: SYNC_SALT,
        ...V1_PARAMETERS,
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
