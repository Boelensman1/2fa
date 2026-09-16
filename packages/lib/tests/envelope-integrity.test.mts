import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'node:crypto'
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
  type EncryptedPrivateKey,
  type EncryptedVaultStateString,
} from '../src/main.mjs'
import type { VaultStateString } from '../src/interfaces/Vault.mjs'
import { buildVaultAad } from '../src/utils/canonical.mjs'
import { nodeProviders } from '../src/platformProviders/node/index.mjs'
import {
  createFavaLibForTests,
  deviceType,
  newTotpEntry,
  passwordExtraDict,
} from './testUtils.mjs'

// @ts-expect-error node crypto and webcrypto don't have the exact same types
globalThis.window = { crypto: crypto.webcrypto }

const cryptoLib = new nodeProviders.CryptoLib()

describe('stored envelope integrity', () => {
  let stored: LockedRepresentationString
  let password: Password
  let salt: Salt
  let kdf: KdfParameters
  let publicKey: PublicKey
  let encryptedPrivateKey: EncryptedPrivateKey
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
    encryptedPrivateKey = result.encryptedPrivateKey

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

    it.each(['envelopeMac', 'kdf'] as const)(
      'refuses a v2 blob with no %s rather than silently accepting it',
      async (field) => {
        const representation = parse() as Partial<LockedRepresentation>
        delete representation[field]

        await expect(
          load(representation as LockedRepresentation),
        ).rejects.toThrow(/missing its kdf parameters or its envelopeMac/)
      },
    )

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

  describe('forged envelope (02-ciphertext-authenticity.md)', () => {
    // THIS TEST IS THE FINDING. The data encryption key arrives RSA-OAEP
    // wrapped under this device's OWN public key, so the AES-GCM tag proves
    // only that the writer held that key -- and anyone who has seen the public
    // key can mint one. The practical route to the public key is a compromised
    // peer, whose vault state carries it in sync.devices; the keypair is never
    // rotated, so one leak is permanent.
    let forged: LockedRepresentation
    let attackerKey: SymmetricKey
    let attackerAad: string

    beforeAll(async () => {
      forged = parse()

      // The attacker picks their own key and wraps it to the victim's public
      // key, which the victim's own private key will happily unwrap.
      attackerKey = await cryptoLib.createSymmetricKey()
      forged.encryptedSymmetricKey = await cryptoLib.encrypt(
        publicKey,
        attackerKey,
      )

      // Every AAD input is cleartext in the file they are writing, so they
      // build a perfectly valid one.
      attackerAad = buildVaultAad(
        STORAGE_VERSION,
        forged.salt,
        forged.kdf,
        await cryptoLib.sha256(forged.encryptedPrivateKey),
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
        attackerAad,
      )
      // encryptedPrivateKey, salt, kdf and libVersion are left untouched, so
      // the victim's real password still unwraps the private key.
    })

    it('is a real forgery: the AEAD layer accepts it completely', async () => {
      // Without this assertion the test below would pass for the wrong reason.
      // The forged ciphertext IS valid under its own key and AAD; nothing in
      // AES-GCM objects to any of it.
      const plaintext = await cryptoLib.decryptSymmetric(
        attackerKey,
        forged.encryptedVaultState,
        attackerAad,
      )
      expect(JSON.parse(plaintext)).toMatchObject({
        sync: { serverUrl: 'wss://attacker.example' },
      })

      const { symmetricKey } = await cryptoLib.decryptKeys(
        forged.encryptedPrivateKey,
        forged.encryptedSymmetricKey,
        forged.salt,
        password,
        forged.kdf,
      )
      // The victim's own private key unwraps the attacker's chosen key.
      expect(symmetricKey).toBe(attackerKey)
    })

    it('is rejected by the envelope MAC', async () => {
      await expect(load(forged)).rejects.toThrow(/failed its integrity check/)
    })
  })

  describe('AAD binding', () => {
    it('binds the vault state to the encrypted private key', async () => {
      // changePassword reuses both the salt AND the symmetric key, re-wrapping
      // only the private key. Without a digest of encryptedPrivateKey in the
      // AAD, the key and the AAD would be identical before and after, and a
      // vault state lifted from a pre-change backup would authenticate under
      // the new password -- silently restoring a deleted entry or a revoked
      // sync device while the rotation appeared to have worked.
      //
      // At the whole-envelope level the MAC also stops this. The binding is
      // what stops it at the ciphertext level, which is the layer that still
      // holds if the MAC key is ever known, so it is asserted there.
      const symmetricKey = await cryptoLib.createSymmetricKey()
      const beforeAad = buildVaultAad(
        STORAGE_VERSION,
        salt,
        kdf,
        await cryptoLib.sha256(encryptedPrivateKey),
      )

      const { encryptedPrivateKey: afterPasswordChange } =
        await cryptoLib.encryptKeys(
          (
            await cryptoLib.decryptKeys(
              encryptedPrivateKey,
              parse().encryptedSymmetricKey,
              salt,
              password,
              kdf,
            )
          ).privateKey,
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
      // The only reader of the v1 CBC envelope is decryptSymmetricV1, and the
      // only caller of that is the vault load path. If decryptSymmetric ever
      // starts accepting a v1 envelope again, the oracle described in
      // 02-ciphertext-authenticity.md is back on the wire.
      const key = await cryptoLib.createSymmetricKey()
      const v1Shaped =
        'bm9uY2Vub25jZW5vbmNlbm8=:c29tZWNpcGhlcnRleHQ=' as EncryptedVaultStateString

      await expect(
        cryptoLib.decryptSymmetric(key, v1Shaped, ''),
      ).rejects.toThrow('Could not decrypt data')
    })
  })
})
