import { describe, expect, test } from 'vitest'
import crypto from 'node:crypto'
import {
  base64ToUint8Array,
  hexToUint8Array,
  stringToUint8Array,
  uint8ArrayToBase64,
} from 'uint8array-extras'

import type { PasswordHash, Salt } from '../../src/main.mjs'
import { nodeProviders } from '../../src/platformProviders/node/index.mjs'
import { browserProviders } from '../../src/platformProviders/browser/index.mjs'

// @ts-expect-error node crypto and webcrypto don't have the exact same types
globalThis.window = { crypto: crypto.webcrypto }

// The envelope MAC is what authenticates a stored vault to the holder of the
// PASSWORD rather than merely to the holder of the data encryption key -- see
// key-hierarchy-review/02-ciphertext-authenticity.md. Its key derivation is
// implemented twice, once per provider, over two different primitives
// (node:crypto hkdf and WebCrypto deriveBits), so it needs pinning against an
// absolute value AND across providers, exactly like createSyncKey.

const nodeCrypto = new nodeProviders.CryptoLib()
const browserCrypto = new browserProviders.CryptoLib()

// The password hash of tests/fixtures/vault-v1.json, reused here on purpose:
// tests/CryptoProviders/kdf-vectors.test.ts pins that this is what argon2id
// produces for that vault, so these two files chain end to end.
const PASSWORD_HASH =
  'bd9c01dab08f03a906c7fd2c155bf14e8e2706d04f0afe8e7afa54508b7526447feb04fb14cf98dc6810e443bf8674d17cc65bf2d65ed7498ec2b9ec4974a0bd' as PasswordHash
const SALT = 'O454a0A723g+U3MYcYoCFA==' as Salt

describe('envelope MAC key derivation', () => {
  test('both providers derive the same key', async () => {
    const fromNode = await nodeCrypto.deriveEnvelopeMacKey(PASSWORD_HASH, SALT)
    const fromBrowser = await browserCrypto.deriveEnvelopeMacKey(
      PASSWORD_HASH,
      SALT,
    )

    expect(fromNode).toBe(fromBrowser)
    // 32 bytes, base64.
    expect(base64ToUint8Array(fromNode)).toHaveLength(32)
  })

  test('the input keying material is the DECODED hash, not its hex text', async () => {
    // This is the whole cross-provider contract in one assertion. Both
    // readings of a hex-encoded hash are plausible -- "the 64 bytes it
    // represents" and "the 128 characters it is written as" -- and a provider
    // that picked the other one would agree with itself perfectly and fail
    // only against the other provider, on a user's second device.
    const derived = await nodeCrypto.deriveEnvelopeMacKey(PASSWORD_HASH, SALT)

    const hkdf = async (ikm: Uint8Array) =>
      uint8ArrayToBase64(
        new Uint8Array(
          await new Promise<ArrayBuffer>((resolve, reject) => {
            crypto.hkdf(
              'sha256',
              ikm,
              stringToUint8Array(SALT),
              stringToUint8Array('favalib:envelope-mac:v2'),
              32,
              (err, key) => (err ? reject(err) : resolve(key)),
            )
          }),
        ),
      )

    expect(derived).toBe(await hkdf(hexToUint8Array(PASSWORD_HASH)))
    expect(derived).not.toBe(await hkdf(stringToUint8Array(PASSWORD_HASH)))
  })

  test('the salt separates keys', async () => {
    const a = await nodeCrypto.deriveEnvelopeMacKey(PASSWORD_HASH, SALT)
    const b = await nodeCrypto.deriveEnvelopeMacKey(
      PASSWORD_HASH,
      'a different salt' as Salt,
    )

    expect(a).not.toBe(b)
  })
})

describe('envelope MAC', () => {
  const message = 'favalib:envelope:v2 test message'

  test('a MAC written by one provider verifies in the other', async () => {
    const macKey = await nodeCrypto.deriveEnvelopeMacKey(PASSWORD_HASH, SALT)

    const fromNode = await nodeCrypto.createEnvelopeMac(macKey, message)
    const fromBrowser = await browserCrypto.createEnvelopeMac(macKey, message)

    expect(fromNode).toBe(fromBrowser)
    await expect(
      browserCrypto.verifyEnvelopeMac(macKey, message, fromNode),
    ).resolves.toBe(true)
    await expect(
      nodeCrypto.verifyEnvelopeMac(macKey, message, fromBrowser),
    ).resolves.toBe(true)
  })

  test.each([
    ['NodeCryptoLib', () => nodeCrypto],
    ['BrowserCryptoLib', () => browserCrypto],
  ])('%s rejects a MAC over a different message', async (_name, get) => {
    const cryptoLib = get()
    const macKey = await cryptoLib.deriveEnvelopeMacKey(PASSWORD_HASH, SALT)
    const mac = await cryptoLib.createEnvelopeMac(macKey, message)

    await expect(
      cryptoLib.verifyEnvelopeMac(macKey, `${message}!`, mac),
    ).resolves.toBe(false)
  })

  test.each([
    ['NodeCryptoLib', () => nodeCrypto],
    ['BrowserCryptoLib', () => browserCrypto],
  ])('%s rejects a MAC under a different key', async (_name, get) => {
    const cryptoLib = get()
    const macKey = await cryptoLib.deriveEnvelopeMacKey(PASSWORD_HASH, SALT)
    const otherKey = await cryptoLib.deriveEnvelopeMacKey(
      PASSWORD_HASH,
      'other' as Salt,
    )
    const mac = await cryptoLib.createEnvelopeMac(macKey, message)

    await expect(
      cryptoLib.verifyEnvelopeMac(otherKey, message, mac),
    ).resolves.toBe(false)
  })

  test.each([
    ['NodeCryptoLib', () => nodeCrypto],
    ['BrowserCryptoLib', () => browserCrypto],
  ])('%s rejects malformed MACs without throwing', async (_name, get) => {
    // A malformed MAC has to be a plain `false`, not an exception: the load
    // path turns a false into one uniform integrity error, and an exception
    // escaping from here would be distinguishable from a wrong one.
    const cryptoLib = get()
    const macKey = await cryptoLib.deriveEnvelopeMacKey(PASSWORD_HASH, SALT)

    for (const bad of ['', 'not base64 at all!!', 'c2hvcnQ=']) {
      await expect(
        cryptoLib.verifyEnvelopeMac(macKey, message, bad),
      ).resolves.toBe(false)
    }
  })
})
