import { describe, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'
import { x25519 } from '@noble/curves/ed25519.js'
import {
  uint8ArrayToBase64,
  uint8ArrayToHex,
  hexToUint8Array,
} from 'uint8array-extras'

import type { PrivateKey } from '../../src/interfaces/CryptoLib.mjs'
import {
  combinePairingShares,
  deriveSealKeyForRecipient,
} from '../../src/platformProviders/shared/asymmetric.mjs'

// Test vectors for the post-quantum layer, on the same footing as
// kdf-vectors.test.ts: without them, a change in @noble/post-quantum or in the
// order bytes are fed to a KDF breaks every peer's ability to talk to every
// other peer with a fully green suite, because every other crypto test only
// asserts that we agree with ourselves.
//
// ## The primitives: cross-checked against OpenSSL, not recorded from noble
//
// The two keygen vectors below were produced by @noble/post-quantum AND
// independently reproduced with OpenSSL 3.6.3, which agreed byte for byte --
// keypairs, an encapsulation and a signature, in both directions. That is what
// makes them vectors rather than a recording of our own output. To re-verify
// without trusting this file:
//
//   SEED=030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ced5dc\
// e3eaf1f8ff060d141b222930373e454c535a61686f767d848b9299a0a7aeb5bc
//   nix shell nixpkgs#openssl -c openssl genpkey -algorithm ML-KEM-768 \
//     -pkeyopt hexseed:$SEED -out kem.pem
//   nix shell nixpkgs#openssl -c openssl pkey -in kem.pem -pubout \
//     -outform DER | tail -c 1184 | sha256sum
//
//   DSEED=05101b26313c47525d68737e89949faab5c0cbd6e1ecf7020d18232e39444f5a
//   nix shell nixpkgs#openssl -c openssl genpkey -algorithm ML-DSA-65 \
//     -pkeyopt hexseed:$DSEED -out dsa.pem
//   nix shell nixpkgs#openssl -c openssl pkey -in dsa.pem -pubout \
//     -outform DER | tail -c 1952 | sha256sum
//
// (The digests print as hex there and are stored as base64 here.)
//
// ## The combiners: cross-checked against a from-scratch HKDF
//
// `deriveSealKeyForRecipient` and `combinePairingShares` are ours, so no other
// implementation has them to compare against. What CAN be checked independently
// is the arithmetic, and that is what was done: both expected values were
// reproduced from the two shared secrets with an HKDF-SHA256 written from
// RFC 5869 in Python, and an `encodeFields` written from its own doc comment.
// The shared secrets feeding them are the ones OpenSSL already agreed with
// above, so the chain is independent end to end.
//
// What these two pin is the part that has no other gate: the ORDER the shares
// are concatenated in, and the exact transcript. Swap the two shares, drop the
// KEM ciphertext from the info, or change a domain separator, and every device
// derives a different key from the same exchange -- which does not throw
// anywhere. It surfaces as two devices that simply cannot talk.
//
// No `globalThis.window` shim here, matching kdf-vectors.test.ts: none of this
// touches window.crypto, and asserting that stays true is half the point of the
// browser provider being usable in a service worker.

/**
 * Builds a fixed byte string, so every input here is reproducible from the file.
 * @param length - How many bytes.
 * @param at - The value of the byte at each index, before the modulo.
 * @returns The bytes.
 */
const bytes = (length: number, at: (index: number) => number) =>
  new Uint8Array(Array.from({ length }, (_, index) => at(index) % 256))

/** The 64-byte ML-KEM seed OpenSSL was given. */
const KEM_SEED = bytes(64, (i) => i * 7 + 3)

/** The 32-byte ML-DSA seed OpenSSL was given. */
const DSA_SEED = bytes(32, (i) => i * 11 + 5)

/** The X25519 secret key half of the recipient's composite secret key. */
const X25519_SECRET = bytes(32, (i) => i + 1)

/** The sender's per-message X25519 secret key. */
const EPHEMERAL_SECRET = bytes(32, (i) => i * 3 + 1)

/**
 * The randomness ML-KEM encapsulation is given, so the ciphertext is fixed.
 *
 * Encapsulation is randomised in normal use -- this argument exists for exactly
 * this purpose, pinning a KAT -- and nothing in the library passes it.
 */
const ENCAPSULATION_MESSAGE = bytes(32, (i) => i * 5 + 2)

/** A stand-in for the key JPAKE derives, which is 32 bytes of shared secret. */
const JPAKE_SHARE = bytes(32, (i) => i * 13 + 7)

/** The responder device id the pairing transcript is bound to. */
const RESPONDER_DEVICE_ID = 'd607e80d-b0af-409b-8e0f-9b983c5bcbf4'

const EXPECTED_KEM_PUBLIC_KEY_DIGEST =
  'IGxf7MILj4kPaVSp9c+/qDu2Sc2X76jfVojw/YyPi18='
const EXPECTED_DSA_PUBLIC_KEY_DIGEST =
  'LD1v1ZAwIzhAOAaHDEKW9W1O3+WA4QQ8KZ05TXcYXSI='
const EXPECTED_KEM_SHARED_SECRET =
  'fe8af8b973c0cf5a0e9b7c876ac79fa79f1c4f204d71e45ef32093813f4e8378'
const EXPECTED_SEAL_KEY = '91d5lISo3V21ZW9HPTgK7uMZpmCBpJU9nkKuyzPX2NQ='
const EXPECTED_PAIRING_KEY_MATERIAL =
  'Yv/Xq4RJjZftuC9vqF6W9uzPgXE+CPtAhpzUzA9VQZ54yFcOjYqLaZOrqURhf7fzkzwBgZdb' +
  'cxhxrGsCB61rsQ=='

/**
 * Digests a value, so a 1952-byte key can be pinned in one readable line.
 * @param value - The bytes to digest.
 * @returns The base64 SHA-256.
 */
const digest = (value: Uint8Array) =>
  createHash('sha256').update(value).digest('base64')

describe('post-quantum test vectors', () => {
  describe('seeded key generation', () => {
    // Seeded keygen is not a convenience here: the device's stored secret key
    // IS the seed, so a change in how a seed expands silently changes which
    // keypair every existing vault holds.
    test('ML-KEM-768 expands the known seed to the known public key', () => {
      expect(digest(ml_kem768.keygen(KEM_SEED).publicKey)).toBe(
        EXPECTED_KEM_PUBLIC_KEY_DIGEST,
      )
    })

    test('ML-DSA-65 expands the known seed to the known public key', () => {
      expect(digest(ml_dsa65.keygen(DSA_SEED).publicKey)).toBe(
        EXPECTED_DSA_PUBLIC_KEY_DIGEST,
      )
    })

    test('both are deterministic, which is what lets a seed be stored', () => {
      expect(ml_kem768.keygen(KEM_SEED).secretKey).toEqual(
        ml_kem768.keygen(KEM_SEED).secretKey,
      )
      expect(ml_dsa65.keygen(DSA_SEED).secretKey).toEqual(
        ml_dsa65.keygen(DSA_SEED).secretKey,
      )
    })
  })

  describe('encapsulation', () => {
    test('the known public key and message produce the known shared secret', () => {
      const { sharedSecret } = ml_kem768.encapsulate(
        ml_kem768.keygen(KEM_SEED).publicKey,
        ENCAPSULATION_MESSAGE,
      )

      expect(uint8ArrayToHex(sharedSecret)).toBe(EXPECTED_KEM_SHARED_SECRET)
    })

    test('decapsulation recovers it', () => {
      const keys = ml_kem768.keygen(KEM_SEED)
      const { cipherText } = ml_kem768.encapsulate(
        keys.publicKey,
        ENCAPSULATION_MESSAGE,
      )

      expect(
        uint8ArrayToHex(ml_kem768.decapsulate(cipherText, keys.secretKey)),
      ).toBe(EXPECTED_KEM_SHARED_SECRET)
    })
  })

  describe('the seal combiner', () => {
    const recipientKeys = () => ml_kem768.keygen(KEM_SEED)

    const sealInputs = () => {
      const { cipherText } = ml_kem768.encapsulate(
        recipientKeys().publicKey,
        ENCAPSULATION_MESSAGE,
      )
      return {
        privateKey: uint8ArrayToBase64(
          new Uint8Array([...X25519_SECRET, ...KEM_SEED]),
        ) as PrivateKey,
        ephemeralPublicKey: uint8ArrayToBase64(
          x25519.getPublicKey(EPHEMERAL_SECRET),
        ),
        kemCipherText: uint8ArrayToBase64(cipherText),
      }
    }

    test('derives the known key from the known exchange', () => {
      const { privateKey, ephemeralPublicKey, kemCipherText } = sealInputs()

      expect(
        deriveSealKeyForRecipient(
          privateKey,
          ephemeralPublicKey,
          kemCipherText,
        ),
      ).toBe(EXPECTED_SEAL_KEY)
    })

    test('a different KEM ciphertext derives a different key', () => {
      // The ciphertext is in the transcript, which is what stops one shared
      // secret meaning two things. Nothing else in the suite would notice if it
      // were dropped from the info -- the seal would still round-trip.
      const { privateKey, ephemeralPublicKey, kemCipherText } = sealInputs()
      const other = ml_kem768.encapsulate(
        recipientKeys().publicKey,
        bytes(32, (i) => i * 5 + 3),
      )

      expect(
        deriveSealKeyForRecipient(
          privateKey,
          ephemeralPublicKey,
          uint8ArrayToBase64(other.cipherText),
        ),
      ).not.toBe(
        deriveSealKeyForRecipient(
          privateKey,
          ephemeralPublicKey,
          kemCipherText,
        ),
      )
    })
  })

  describe('the pairing combiner', () => {
    const kemSharedSecret = () => hexToUint8Array(EXPECTED_KEM_SHARED_SECRET)

    const kemCipherText = () =>
      uint8ArrayToBase64(
        ml_kem768.encapsulate(
          ml_kem768.keygen(KEM_SEED).publicKey,
          ENCAPSULATION_MESSAGE,
        ).cipherText,
      )

    test('combines the known shares into the known key material', () => {
      expect(
        uint8ArrayToBase64(
          combinePairingShares(
            kemSharedSecret(),
            JPAKE_SHARE,
            RESPONDER_DEVICE_ID,
            kemCipherText(),
          ),
        ),
      ).toBe(EXPECTED_PAIRING_KEY_MATERIAL)
    })

    test('the two shares are not interchangeable', () => {
      // Post-quantum share first. If the two were ever swapped on one side of
      // the exchange only, both devices would finish the pairing believing it
      // had worked and then fail to decrypt anything the other sent.
      expect(
        uint8ArrayToBase64(
          combinePairingShares(
            JPAKE_SHARE,
            kemSharedSecret(),
            RESPONDER_DEVICE_ID,
            kemCipherText(),
          ),
        ),
      ).not.toBe(EXPECTED_PAIRING_KEY_MATERIAL)
    })

    test('a different responder binds to different key material', () => {
      expect(
        uint8ArrayToBase64(
          combinePairingShares(
            kemSharedSecret(),
            JPAKE_SHARE,
            'a-different-device',
            kemCipherText(),
          ),
        ),
      ).not.toBe(EXPECTED_PAIRING_KEY_MATERIAL)
    })
  })
})
