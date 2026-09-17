/* eslint no-restricted-globals: ["error", "Error"] */
import { promisify } from 'node:util'
import {
  generateKey as generateKeyCb,
  hkdf as hkdfCb,
  createHash,
  createHmac,
  timingSafeEqual,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto'
import { argon2id } from 'hash-wasm'
import { toUint8Array } from 'uint8array-extras'

import { CryptoError } from '../../FavaLibError.mjs'
import type CryptoLib from '../../interfaces/CryptoLib.mjs'
import type {
  DeviceSecretKeys,
  Encrypted,
  EncryptedSecretKeys,
  EncryptedSymmetricKey,
  KdfParameters,
  MacKey,
  Password,
  PasswordHash,
  PrivateKey,
  PublicKey,
  Salt,
  Signature,
  SigningPublicKey,
  SigningSecretKey,
  SymmetricKey,
  SyncKey,
} from '../../interfaces/CryptoLib.mjs'
import { SYNC_KDF_PARAMETERS, V2_KDF_PARAMETERS } from '../../version.mjs'
import { buildKeyWrapAad } from '../../utils/canonical.mjs'
import { generatePasswordHash } from '../browser/cryptoLib.mjs'
import {
  createEncryptionKeyPair,
  createSigningKeyPair,
  encryptionPublicKeyFromSecret,
  openSeal,
  parseSecretKeys,
  sealTo,
  serialiseSecretKeys,
  signMessage,
  signingPublicKeyFromSecret,
  verifyMessage,
} from '../shared/curves.mjs'

const generateKey = promisify(generateKeyCb)
const hkdf = promisify(hkdfCb)

/** See the browser provider: GCM nonces are 12 bytes. */
const GCM_NONCE_BYTES = 12

/** The AES-GCM authentication tag length, in bytes. */
const GCM_TAG_BYTES = 16

/** Marks a storage version 2 ciphertext envelope. */
const V2_ENVELOPE_PREFIX = 'v2'

/** HKDF info for the key that seals the device's two secret keys at rest. */
const KEY_WRAP_INFO = 'favalib:key-wrap:v2'

/** HKDF info for the key that seals the vault's symmetric key at rest. */
const DEK_WRAP_INFO = 'favalib:dek-wrap:v2'

/** HKDF info for the envelope MAC key. */
const ENVELOPE_MAC_INFO = 'favalib:envelope-mac:v2'

/**
 * @inheritdoc
 */
class NodeCryptoLib implements CryptoLib {
  /**
   * @inheritdoc
   */
  async getRandomBytes(count: number) {
    return Promise.resolve(toUint8Array(randomBytes(count)))
  }

  /**
   * @inheritdoc
   */
  async sha256(data: string): Promise<string> {
    return Promise.resolve(
      createHash('sha256').update(data, 'utf8').digest('base64'),
    )
  }

  /**
   * @inheritdoc
   */
  async createKeys(password: Password) {
    // create random salt
    const salt = randomBytes(16).toString('base64') as Salt

    // create passwordHash -- ONCE. This used to run argon2 a second time via a
    // decryptKeys round trip that existed only to recover the plaintext
    // private key, which the keygen can hand us directly. See
    // key-hierarchy-review/10-rsa-layer.md; at m=64 MiB/t=3/p=4 that round
    // trip would cost ~260 ms per vault creation for nothing.
    const passwordHash = await generatePasswordHash(
      salt,
      password,
      V2_KDF_PARAMETERS,
    )

    const { privateKey, publicKey } = createEncryptionKeyPair()
    const { signingSecretKey, signingPublicKey } = createSigningKeyPair()
    const symmetricKey = await this.createSymmetricKey()

    const sealed = await this.sealKeyMaterial(
      { privateKey, signingSecretKey },
      symmetricKey,
      passwordHash,
      salt,
      V2_KDF_PARAMETERS,
    )
    const macKey = await this.deriveEnvelopeMacKey(passwordHash, salt)

    return {
      privateKey,
      signingSecretKey,
      symmetricKey,
      publicKey,
      signingPublicKey,
      salt,
      ...sealed,
      macKey,
      kdf: V2_KDF_PARAMETERS,
    }
  }

  /**
   * @inheritdoc
   */
  async encryptKeys(
    secretKeys: DeviceSecretKeys,
    symmetricKey: SymmetricKey,
    salt: Salt,
    password: Password,
    kdf: KdfParameters = V2_KDF_PARAMETERS,
  ) {
    // recreate passwordHash
    const passwordHash = await generatePasswordHash(salt, password, kdf)

    const sealed = await this.sealKeyMaterial(
      secretKeys,
      symmetricKey,
      passwordHash,
      salt,
      kdf,
    )
    const macKey = await this.deriveEnvelopeMacKey(passwordHash, salt)

    return { ...sealed, macKey }
  }

  /**
   * @inheritdoc
   */
  async decryptKeys(
    encryptedSecretKeys: EncryptedSecretKeys,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    password: Password,
    kdf: KdfParameters = V2_KDF_PARAMETERS,
  ): Promise<{
    privateKey: PrivateKey
    signingSecretKey: SigningSecretKey
    symmetricKey: SymmetricKey
    publicKey: PublicKey
    signingPublicKey: SigningPublicKey
    macKey: MacKey
  }> {
    // recreate passwordHash
    const passwordHash = await generatePasswordHash(salt, password, kdf)

    const secretKeys = await this.openSecretKeys(
      encryptedSecretKeys,
      passwordHash,
      salt,
      kdf,
    )
    const symmetricKey = await this.decryptSymmetric(
      await this.deriveWrappingKey(passwordHash, salt, DEK_WRAP_INFO),
      encryptedSymmetricKey,
      buildKeyWrapAad('symmetric-key', salt, kdf),
    )

    // Same passwordHash, no second derivation: at m=64 MiB/t=3/p=4 a second
    // argon2 run would add ~260 ms to every unlock.
    const macKey = await this.deriveEnvelopeMacKey(passwordHash, salt)

    return {
      ...secretKeys,
      publicKey: encryptionPublicKeyFromSecret(secretKeys.privateKey),
      signingPublicKey: signingPublicKeyFromSecret(secretKeys.signingSecretKey),
      symmetricKey,
      macKey,
    }
  }

  /**
   * @inheritdoc
   */
  async deriveEnvelopeMacKey(
    passwordHash: PasswordHash,
    salt: Salt,
  ): Promise<MacKey> {
    return (await this.deriveWrappingKey(
      passwordHash,
      salt,
      ENVELOPE_MAC_INFO,
    )) as string as MacKey
  }

  /**
   * Derives one of the three keys the password hash feeds: the two at-rest
   * wrapping keys and the envelope MAC key.
   *
   * They differ only in the HKDF info, which is what keeps them independent --
   * a seal made under one can never be opened with another, whatever a caller
   * confuses.
   * @param passwordHash - The argon2id password hash (hex).
   * @param salt - The vault salt, used as the HKDF salt.
   * @param info - The domain separator for this key's purpose.
   * @returns A promise resolving to the derived key, base64 encoded.
   */
  private async deriveWrappingKey(
    passwordHash: PasswordHash,
    salt: Salt,
    info: string,
  ): Promise<SymmetricKey> {
    // Buffer.from(hash, 'hex'), NOT 'utf8': the input keying material is the
    // 64 bytes the hash represents, not the 128 characters it is printed as.
    // Both readings "work" in isolation and diverge silently between
    // providers, so this line is the cross-provider contract.
    const ikm = Buffer.from(passwordHash, 'hex')
    const bits = await hkdf(
      'sha256',
      ikm,
      Buffer.from(salt, 'utf8'),
      Buffer.from(info, 'utf8'),
      32,
    )
    return Buffer.from(bits).toString('base64') as SymmetricKey
  }

  /**
   * Seals a device's secret keys and its symmetric key under the password.
   *
   * Two seals under two separately derived keys, rather than one blob holding
   * everything: `changePassword` rewrites both, but a resilver and an unlock
   * need only one of them, and keeping them apart means neither path can be
   * made to read the other's bytes.
   * @param secretKeys - The device's two secret keys.
   * @param symmetricKey - The key the vault state is encrypted under.
   * @param passwordHash - The argon2id password hash (hex).
   * @param salt - The vault salt.
   * @param kdf - The parameters the hash was produced with.
   * @returns A promise resolving to both sealed forms.
   */
  private async sealKeyMaterial(
    secretKeys: DeviceSecretKeys,
    symmetricKey: SymmetricKey,
    passwordHash: PasswordHash,
    salt: Salt,
    kdf: KdfParameters,
  ): Promise<{
    encryptedSecretKeys: EncryptedSecretKeys
    encryptedSymmetricKey: EncryptedSymmetricKey
  }> {
    const encryptedSecretKeys = await this.encryptSymmetric(
      await this.deriveWrappingKey(passwordHash, salt, KEY_WRAP_INFO),
      serialiseSecretKeys(secretKeys),
      buildKeyWrapAad('secret-keys', salt, kdf),
    )
    const encryptedSymmetricKey = await this.encryptSymmetric(
      await this.deriveWrappingKey(passwordHash, salt, DEK_WRAP_INFO),
      symmetricKey,
      buildKeyWrapAad('symmetric-key', salt, kdf),
    )

    return { encryptedSecretKeys, encryptedSymmetricKey }
  }

  /**
   * Opens the seal around a device's secret keys.
   *
   * A failure here is reported as an invalid password, which is what it almost
   * always is: at rest the password is the only variable, and the alternative
   * -- a modified vault -- is what the envelope MAC is checked for immediately
   * afterwards, with a message that says so.
   * @param encryptedSecretKeys - The sealed secret keys.
   * @param passwordHash - The argon2id password hash (hex).
   * @param salt - The vault salt.
   * @param kdf - The parameters the hash was produced with.
   * @returns A promise resolving to the two secret keys.
   * @throws {CryptoError} If the seal does not open.
   */
  private async openSecretKeys(
    encryptedSecretKeys: EncryptedSecretKeys,
    passwordHash: PasswordHash,
    salt: Salt,
    kdf: KdfParameters,
  ): Promise<DeviceSecretKeys> {
    let serialised: string
    try {
      serialised = await this.decryptSymmetric(
        await this.deriveWrappingKey(passwordHash, salt, KEY_WRAP_INFO),
        encryptedSecretKeys,
        buildKeyWrapAad('secret-keys', salt, kdf),
      )
    } catch {
      throw new CryptoError('Invalid password')
    }
    return parseSecretKeys(serialised)
  }

  /**
   * @inheritdoc
   */
  async createEnvelopeMac(macKey: MacKey, message: string): Promise<string> {
    return Promise.resolve(
      createHmac('sha256', Buffer.from(macKey, 'base64'))
        .update(message, 'utf8')
        .digest('base64'),
    )
  }

  /**
   * @inheritdoc
   */
  async verifyEnvelopeMac(
    macKey: MacKey,
    message: string,
    mac: string,
  ): Promise<boolean> {
    const expected = Buffer.from(
      await this.createEnvelopeMac(macKey, message),
      'base64',
    )
    const actual = Buffer.from(mac, 'base64')
    if (actual.length !== expected.length) {
      return false
    }
    // timingSafeEqual, not ===: a byte-at-a-time comparison on the base64
    // leaks a prefix-length oracle.
    return timingSafeEqual(expected, actual)
  }

  /**
   * @inheritdoc
   */
  async encrypt<T extends string>(publicKey: PublicKey, plainText: T) {
    return sealTo(this, publicKey, plainText)
  }

  /**
   * @inheritdoc
   */
  async decrypt<T extends string>(
    privateKey: PrivateKey,
    encryptedText: Encrypted<T>,
  ) {
    return openSeal(this, privateKey, encryptedText)
  }

  /**
   * @inheritdoc
   */
  async sign(signingSecretKey: SigningSecretKey, message: string) {
    return Promise.resolve(signMessage(signingSecretKey, message))
  }

  /**
   * @inheritdoc
   */
  async verify(
    signingPublicKey: SigningPublicKey,
    message: string,
    signature: Signature,
  ) {
    return Promise.resolve(verifyMessage(signingPublicKey, message, signature))
  }

  /**
   * @inheritdoc
   */
  async encryptSymmetric<T extends string>(
    symmetricKey: SymmetricKey,
    plainText: T,
    aad: string,
  ) {
    const nonce = randomBytes(GCM_NONCE_BYTES)
    const keyBuffer = Buffer.from(symmetricKey, 'base64')
    const cipher = createCipheriv('aes-256-gcm', keyBuffer, nonce)
    cipher.setAAD(Buffer.from(aad, 'utf8'))
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ])
    // Append the tag, matching what WebCrypto does implicitly, so both
    // providers produce the same envelope.
    const payload = Buffer.concat([encrypted, cipher.getAuthTag()])
    return Promise.resolve(
      [
        V2_ENVELOPE_PREFIX,
        nonce.toString('base64'),
        payload.toString('base64'),
      ].join(':') as Encrypted<T>,
    )
  }

  /**
   * @inheritdoc
   */
  // Returns Promise.resolve rather than awaiting: the interface is async
  // because the browser provider genuinely is, while node's AES-GCM is
  // synchronous throughout.
  async decryptSymmetric<T extends string>(
    symmetricKey: SymmetricKey,
    encryptedText: Encrypted<T>,
    aad: string,
  ) {
    const parts = encryptedText.split(':')
    if (parts.length !== 3 || parts[0] !== V2_ENVELOPE_PREFIX) {
      // A storage version 1 envelope -- base64(iv):base64(ct), AES-256-CBC --
      // reaching here is a bug or an attack. Nothing in the library reads that
      // format any more (key-hierarchy-review/18-anti-rollback.md), and the
      // shape is refused rather than attempted, which is what keeps the CBC
      // padding oracle off the sync path.
      throw new CryptoError('Could not decrypt data')
    }
    const [, nonceString, encryptedData] = parts

    try {
      const payload = Buffer.from(encryptedData, 'base64')
      if (payload.length < GCM_TAG_BYTES) {
        throw new CryptoError('Could not decrypt data')
      }
      const tag = payload.subarray(payload.length - GCM_TAG_BYTES)
      const cipherText = payload.subarray(0, payload.length - GCM_TAG_BYTES)

      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(symmetricKey, 'base64'),
        Buffer.from(nonceString, 'base64'),
      )
      decipher.setAAD(Buffer.from(aad, 'utf8'))
      decipher.setAuthTag(tag)
      const decrypted = Buffer.concat([
        decipher.update(cipherText),
        decipher.final(),
      ])
      return Promise.resolve(decrypted.toString('utf8') as T)
    } catch {
      // Deliberately one message for every cause -- bad tag, bad nonce, bad
      // aad, malformed base64, wrong key. A decrypt that distinguishes them is
      // the oracle 02-ciphertext-authenticity.md is about.
      throw new CryptoError('Could not decrypt data')
    }
  }

  /**
   * @inheritdoc
   */
  async createSymmetricKey(): Promise<SymmetricKey> {
    const key = await generateKey('aes', { length: 256 })
    return key.export().toString('base64') as SymmetricKey
  }

  /**
   * @inheritdoc
   */
  async createSyncKey(sharedKey: Uint8Array, salt: string): Promise<SyncKey> {
    const keyBuffer = await argon2id({
      password: sharedKey,
      salt,
      parallelism: SYNC_KDF_PARAMETERS.parallelism,
      iterations: SYNC_KDF_PARAMETERS.iterations,
      memorySize: SYNC_KDF_PARAMETERS.memorySize,
      hashLength: 32,
      outputType: 'binary',
    })
    return Buffer.from(keyBuffer).toString('base64') as SyncKey
  }
}

export default NodeCryptoLib
