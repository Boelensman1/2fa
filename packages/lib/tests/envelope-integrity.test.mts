import { describe, it, expect, beforeAll } from 'vitest'
import { base64ToUint8Array, uint8ArrayToBase64 } from 'uint8array-extras'

import {
  getFavaLibVaultCreationUtils,
  STORAGE_VERSION,
  type FavaLib,
  type KdfParameters,
  type LockedRepresentation,
  type LockedRepresentationString,
  type Password,
  type PublicKey,
  type Salt,
  type SymmetricKey,
  type EncryptedSecretKeys,
  type EncryptedVaultStateString,
  type Signature,
} from '../src/main.mjs'
import type { VaultStateString } from '../src/interfaces/Vault.mjs'
import { buildVaultAad } from '../src/utils/canonical.mjs'
import { nodeProviders } from '../src/platformProviders/node/index.mjs'
import {
  createEncryptionKeyPair,
  createSigningKeyPair,
  ED25519_SIGNATURE_BYTES,
} from '../src/platformProviders/shared/asymmetric.mjs'
import {
  createFavaLibForTests,
  deviceType,
  newTotpEntry,
  passwordExtraDict,
} from './testUtils.mjs'

const cryptoLib = new nodeProviders.CryptoLib()

describe('stored envelope integrity', () => {
  let stored: LockedRepresentationString
  let password: Password
  let salt: Salt
  let kdf: KdfParameters
  let publicKey: PublicKey
  let encryptedSecretKeys: EncryptedSecretKeys
  let favaLib: FavaLib

  const utils = () =>
    getFavaLibVaultCreationUtils(nodeProviders, deviceType, passwordExtraDict)

  const load = (representation: LockedRepresentation, pw = password) =>
    utils().loadFavaLibFromLockedRepesentation(
      JSON.stringify(representation) as LockedRepresentationString,
      pw,
      { connectToSyncServer: false },
    )

  const parse = () => JSON.parse(stored) as LockedRepresentation

  beforeAll(async () => {
    const result = await createFavaLibForTests((representation) => {
      stored = representation
    })
    favaLib = result.favaLib
    password = result.password
    salt = result.salt
    kdf = result.kdf
    publicKey = result.publicKey
    encryptedSecretKeys = result.encryptedSecretKeys

    await favaLib.vault.addEntry(newTotpEntry)
    await favaLib.storage.forceSave()
  })

  it('opens when untouched', async () => {
    const opened = await load(parse())
    await opened.ready
    expect(opened.vault.listEntriesMetas()).toHaveLength(1)
    opened.sync?.closeServerConnection()
  })

  describe('the envelope MAC', () => {
    // These are the fields whose ONLY protection is the MAC. The ones in the
    // block below are already covered by the key derivation, and fail earlier.
    it.each([
      [
        'libVersion',
        (r: LockedRepresentation) => {
          r.libVersion = '99.0.0'
        },
      ],
      [
        'encryptedVaultState',
        (r: LockedRepresentation) => {
          const parts = r.encryptedVaultState.split(':')
          const bytes = base64ToUint8Array(parts[2])
          bytes[0] ^= 0xff
          parts[2] = uint8ArrayToBase64(bytes)
          r.encryptedVaultState = parts.join(':') as EncryptedVaultStateString
        },
      ],
    ])('rejects a tampered %s', async (_field, tamper) => {
      const representation = parse()
      tamper(representation)

      await expect(load(representation)).rejects.toThrow(
        /failed its integrity check/,
      )
    })

    it('rejects a tampered envelopeMac itself', async () => {
      const representation = parse()
      const bytes = base64ToUint8Array(representation.envelopeMac)
      bytes[0] ^= 0xff
      representation.envelopeMac = uint8ArrayToBase64(bytes)

      await expect(load(representation)).rejects.toThrow(
        /failed its integrity check/,
      )
    })

    // Tampering with these breaks the key derivation before the MAC is ever
    // reached, so the error is the key error, not the integrity one. Asserted
    // so that the difference is a decision on record rather than a surprise.
    it.each([
      [
        'salt',
        (r: LockedRepresentation) => {
          r.salt = 'AAAAAAAAAAAAAAAAAAAAAA==' as Salt
        },
      ],
      [
        'kdf.iterations',
        (r: LockedRepresentation) => {
          r.kdf = { ...r.kdf, iterations: r.kdf.iterations + 1 }
        },
      ],
    ])('rejects a tampered %s at the key derivation', async (_f, tamper) => {
      const representation = parse()
      tamper(representation)

      await expect(load(representation)).rejects.toThrow('Invalid password')
    })

    it('still says "Invalid password" for a wrong password', async () => {
      // The MAC is verified AFTER the keys are unwrapped precisely so that
      // this message survives: a wrong password produces a wrong MAC key too,
      // and checking the MAC first would turn every typo into an
      // indistinguishable integrity error.
      await expect(
        load(parse(), 'not-the-password' as Password),
      ).rejects.toThrow('Invalid password')
    })
  })

  describe('the forgery that made the MAC necessary', () => {
    // THIS TEST WAS THE FINDING, and what it asserts has changed.
    //
    // The data encryption key used to arrive RSA-OAEP wrapped under this
    // device's OWN public key, so anyone who had ever seen that public key --
    // a compromised peer, whose vault state carries it in sync.devices -- could
    // choose their own symmetric key, wrap it, re-encrypt the whole vault state
    // and build a matching AAD out of the cleartext they were writing. The
    // AES-GCM tag proved only that the writer held a key of their own choosing,
    // which is exactly why the envelope MAC had to be added.
    //
    // Storage version 2 no longer wraps anything to this device's public key:
    // `encryptedSymmetricKey` is sealed under a key derived from the password
    // hash. The attack has no entry point left, and this is what says so.
    let forged: LockedRepresentation
    let attackerKey: SymmetricKey

    beforeAll(async () => {
      forged = parse()

      // The attacker does exactly what used to work: picks their own key and
      // seals it to the victim's public key, which is public by definition.
      attackerKey = await cryptoLib.createSymmetricKey()
      forged.encryptedSymmetricKey = await cryptoLib.encrypt(
        publicKey,
        attackerKey,
      )
      forged.encryptedVaultState = await cryptoLib.encryptSymmetric(
        attackerKey,
        JSON.stringify({
          deviceId: favaLib.meta.deviceId,
          vault: [],
          sync: {
            devices: [],
            serverUrl: 'wss://attacker.example',
            commandSendQueue: [],
          },
        }) as VaultStateString,
        // Every AAD input is cleartext in the file they are writing, so they
        // still build a perfectly valid one. That was never the weak part.
        buildVaultAad(
          STORAGE_VERSION,
          forged.salt,
          forged.kdf,
          await cryptoLib.sha256(forged.encryptedSecretKeys),
        ),
      )
    })

    it('no longer reaches the victim: the key slot is not public any more', async () => {
      // The victim's own secret key used to unwrap the attacker's chosen key
      // here, and the assertion was `expect(symmetricKey).toBe(attackerKey)`.
      // Now the slot holds a seal under a PASSWORD-derived key, so a value
      // sealed to the public key is not a value this path can open at all.
      await expect(
        cryptoLib.decryptKeys(
          forged.encryptedSecretKeys,
          forged.encryptedSymmetricKey,
          forged.salt,
          password,
          forged.kdf,
        ),
      ).rejects.toThrow('Could not decrypt data')
    })

    it('is refused on load', async () => {
      await expect(load(forged)).rejects.toThrow()
    })
  })

  describe('AAD binding', () => {
    it('binds the vault state to the encrypted private key, independently of the salt', async () => {
      // The salt and the symmetric key are held FIXED here on purpose, so the
      // only thing moving between the two AADs is the wrapped private key. A
      // real password change rotates all three, which would assert nothing
      // about this field in particular.
      //
      // What the binding buys is that a vault state cannot be carried across a
      // re-wrap of the private key under any circumstances -- including the
      // one this field was added for, when changePassword moved nothing else.
      //
      // At the whole-envelope level the MAC also stops this. The binding is
      // what stops it at the ciphertext level, which is the layer that still
      // holds if the MAC key is ever known, so it is asserted there.
      const symmetricKey = await cryptoLib.createSymmetricKey()
      const beforeAad = buildVaultAad(
        STORAGE_VERSION,
        salt,
        kdf,
        await cryptoLib.sha256(encryptedSecretKeys),
      )

      const opened = await cryptoLib.decryptKeys(
        encryptedSecretKeys,
        parse().encryptedSymmetricKey,
        salt,
        password,
        kdf,
      )
      const { encryptedSecretKeys: afterPasswordChange } =
        await cryptoLib.encryptKeys(
          {
            privateKey: opened.privateKey,
            signingSecretKey: opened.signingSecretKey,
          },
          symmetricKey,
          salt,
          'a-completely-different-password' as Password,
          kdf,
        )
      const afterAad = buildVaultAad(
        STORAGE_VERSION,
        salt,
        kdf,
        await cryptoLib.sha256(afterPasswordChange),
      )

      expect(afterAad).not.toBe(beforeAad)

      const ciphertext = await cryptoLib.encryptSymmetric(
        symmetricKey,
        'the pre-change vault state' as VaultStateString,
        beforeAad,
      )
      await expect(
        cryptoLib.decryptSymmetric(symmetricKey, ciphertext, afterAad),
      ).rejects.toThrow('Could not decrypt data')
    })
  })

  describe('the v2 ciphertext envelope', () => {
    const message = 'some plaintext' as VaultStateString
    const aad = 'favalib:test:v2'

    it.each([
      ['the ciphertext', 2],
      ['the nonce', 1],
    ])('rejects a flipped byte in %s', async (_label, index) => {
      const key = await cryptoLib.createSymmetricKey()
      const parts = (await cryptoLib.encryptSymmetric(key, message, aad)).split(
        ':',
      )
      const bytes = base64ToUint8Array(parts[index])
      bytes[0] ^= 0xff
      parts[index] = uint8ArrayToBase64(bytes)

      await expect(
        cryptoLib.decryptSymmetric(
          key,
          parts.join(':') as EncryptedVaultStateString,
          aad,
        ),
      ).rejects.toThrow('Could not decrypt data')
    })

    it('rejects a flipped byte in the authentication tag', async () => {
      const key = await cryptoLib.createSymmetricKey()
      const parts = (await cryptoLib.encryptSymmetric(key, message, aad)).split(
        ':',
      )
      const bytes = base64ToUint8Array(parts[2])
      // The tag is the last 16 bytes of the payload.
      bytes[bytes.length - 1] ^= 0xff
      parts[2] = uint8ArrayToBase64(bytes)

      await expect(
        cryptoLib.decryptSymmetric(
          key,
          parts.join(':') as EncryptedVaultStateString,
          aad,
        ),
      ).rejects.toThrow('Could not decrypt data')
    })

    it('refuses a v1 envelope, so the padding oracle is off the sync path', async () => {
      // Nothing reads the storage version 1 CBC envelope any more. This asserts
      // the shape stays refused: if decryptSymmetric ever starts accepting it
      // again, the CBC padding oracle is back on the wire.
      const key = await cryptoLib.createSymmetricKey()
      const v1Shaped =
        'bm9uY2Vub25jZW5vbmNlbm8=:c29tZWNpcGhlcnRleHQ=' as EncryptedVaultStateString

      await expect(
        cryptoLib.decryptSymmetric(key, v1Shaped, ''),
      ).rejects.toThrow('Could not decrypt data')
    })
  })

  describe('the hybrid seal', () => {
    const message = 'sealed plaintext' as VaultStateString

    /**
     * Builds a fresh recipient keypair, so no test depends on another's.
     * @returns The composite key agreement keypair.
     */
    const recipient = () => createEncryptionKeyPair()

    it('refuses a four-field seal, which is what a pre-quantum peer sends', async () => {
      // The field count is the whole gate. A seal from before the ML-KEM leg
      // has no ciphertext field, and there is no fallback that would open it --
      // so it has to fail here, on shape, rather than reaching a primitive that
      // would name itself in the error.
      const { privateKey, publicKey: recipientKey } = recipient()
      const parts = (await cryptoLib.encrypt(recipientKey, message)).split(':')
      expect(parts).toHaveLength(5)

      const withoutKemCipherText = [
        parts[0],
        parts[1],
        parts[3],
        parts[4],
      ].join(':') as EncryptedVaultStateString

      await expect(
        cryptoLib.decrypt(privateKey, withoutKemCipherText),
      ).rejects.toThrow('Could not decrypt data')
    })

    it.each([
      ['the ephemeral public key', 1],
      ['the ML-KEM ciphertext', 2],
    ])(
      'rejects a flipped byte in %s, with the same error as everything else',
      async (_label, index) => {
        // ML-KEM decapsulation does not fail on a ciphertext that is not its
        // own -- implicit rejection hands back an unrelated shared secret -- so
        // a tampered ciphertext has to surface at the GCM tag, indistinguishably
        // from a tampered anything else. That indistinguishability is the point:
        // a seal that said which half was wrong would be an oracle.
        const { privateKey, publicKey: recipientKey } = recipient()
        const parts = (await cryptoLib.encrypt(recipientKey, message)).split(
          ':',
        )
        const bytes = base64ToUint8Array(parts[index])
        bytes[0] ^= 0xff
        parts[index] = uint8ArrayToBase64(bytes)

        await expect(
          cryptoLib.decrypt(
            privateKey,
            parts.join(':') as EncryptedVaultStateString,
          ),
        ).rejects.toThrow('Could not decrypt data')
      },
    )
  })

  describe('the composite signature', () => {
    const message = 'a canonical message'

    it('verifies when both halves are intact', async () => {
      const { signingSecretKey, signingPublicKey } = createSigningKeyPair()
      const signature = await cryptoLib.sign(signingSecretKey, message)

      expect(await cryptoLib.verify(signingPublicKey, message, signature)).toBe(
        true,
      )
    })

    // Both directions, because an implementation that ORs the two halves
    // instead of ANDing them passes whichever direction you happen to test
    // first. The whole value of carrying two signatures is that an attacker has
    // to forge both, and an OR would make the pair exactly as strong as its
    // weaker half.
    it.each([
      ['the Ed25519 half', 0],
      ['the ML-DSA half', ED25519_SIGNATURE_BYTES],
    ])('is refused when only %s is corrupted', async (_label, offset) => {
      const { signingSecretKey, signingPublicKey } = createSigningKeyPair()
      const signature = await cryptoLib.sign(signingSecretKey, message)
      const bytes = base64ToUint8Array(signature)
      bytes[offset] ^= 0xff

      expect(
        await cryptoLib.verify(
          signingPublicKey,
          message,
          uint8ArrayToBase64(bytes) as Signature,
        ),
      ).toBe(false)
    })
  })
})
