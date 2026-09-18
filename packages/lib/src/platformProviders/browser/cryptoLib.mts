import {
  base64ToUint8Array,
  hexToUint8Array,
  stringToUint8Array,
  uint8ArrayToBase64,
  uint8ArrayToString,
} from 'uint8array-extras'
import { argon2id } from 'hash-wasm'

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
} from '../shared/asymmetric.mjs'

/**
 * The WebCrypto implementation, named so that it resolves in every browser
 * context rather than only in a page.
 *
 * `globalThis` is the same object as `window` in a page and as `self` in a
 * worker, so this one expression covers all of them -- including an MV3
 * extension service worker, which is where `favabrowserext` unlocks the vault
 * and which has no `window` at all. Keep it that way: a `window.crypto`
 * fallback chain would throw a ReferenceError on the `window` lookup itself
 * before it could fall back, so it would need a `typeof` guard just to reach
 * the object `globalThis` already names directly.
 */
const webcrypto = globalThis.crypto

/**
 * The AES-GCM nonce length, in bytes. Twelve, not the sixteen the AES-CBC it
 * replaced used: 96 bits is the only length GCM's counter construction handles
 * without an extra GHASH pass, and it is what every implementation agrees on.
 */
const GCM_NONCE_BYTES = 12

/**
 * The prefix that marks a storage version 2 ciphertext envelope.
 *
 * Storage version 1's envelope was `base64(iv) + ":" + base64(ct)`, whose first
 * field is always exactly 24 base64 characters, so the two shapes cannot be
 * confused. Nothing reads that format any more, but the prefix is what makes
 * the refusal explicit rather than inferred.
 */
const V2_ENVELOPE_PREFIX = 'v2'

/** HKDF info for the key that seals the device's two secret keys at rest. */
const KEY_WRAP_INFO = 'favalib:key-wrap:v2'

/** HKDF info for the key that seals the vault's symmetric key at rest. */
const DEK_WRAP_INFO = 'favalib:dek-wrap:v2'

/** HKDF info for the envelope MAC key. */
const ENVELOPE_MAC_INFO = 'favalib:envelope-mac:v2'

/**
 * Create a password hash
 * @param salt - The salt to use
 * @param password - The password to hash
 * @param parameters - The argon2id cost parameters. A stored vault records its
 * own in the LockedRepresentation; the default is what a new one gets.
 * @returns The calculated password hash
 */
export const generatePasswordHash = (
  salt: Salt,
  password: string,
  parameters: KdfParameters = V2_KDF_PARAMETERS,
): Promise<PasswordHash> => {
  return argon2id({
    password,
    salt,
    parallelism: parameters.parallelism,
    iterations: parameters.iterations,
    memorySize: parameters.memorySize,
    hashLength: parameters.hashLength,
    outputType: 'hex',
  }) as Promise<PasswordHash>
}

/**
 * @inheritdoc
 */
class BrowserCryptoLib implements CryptoLib {
  /**
   * @inheritdoc
   */
  async getRandomBytes(count: number) {
    return Promise.resolve(webcrypto.getRandomValues(new Uint8Array(count)))
  }

  /**
   * @inheritdoc
   */
  async sha256(data: string): Promise<string> {
    const digest = await webcrypto.subtle.digest(
      'SHA-256',
      stringToUint8Array(data),
    )
    return uint8ArrayToBase64(new Uint8Array(digest))
  }

  /**
   * @inheritdoc
   */
  async createKeys(password: Password) {
    // create random salt
    const salt = uint8ArrayToBase64(
      webcrypto.getRandomValues(new Uint8Array(16)),
    ) as Salt

    // create passwordHash
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
    // Derived from the passwordHash we already have; never a second argon2 run.
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
    // hexToUint8Array, NOT stringToUint8Array: the input keying material is
    // the 64 bytes the hash represents, not the 128 characters it is printed
    // as. Both readings "work" in isolation and diverge silently between
    // providers, so this line is the cross-provider contract.
    const ikm = hexToUint8Array(passwordHash)
    const key = await webcrypto.subtle.importKey('raw', ikm, 'HKDF', false, [
      'deriveBits',
    ])
    const bits = await webcrypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: stringToUint8Array(salt),
        info: stringToUint8Array(info),
      },
      key,
      256,
    )
    return uint8ArrayToBase64(new Uint8Array(bits)) as SymmetricKey
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
    const key = await webcrypto.subtle.importKey(
      'raw',
      base64ToUint8Array(macKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const mac = await webcrypto.subtle.sign(
      'HMAC',
      key,
      stringToUint8Array(message),
    )
    return uint8ArrayToBase64(new Uint8Array(mac))
  }

  /**
   * @inheritdoc
   */
  async verifyEnvelopeMac(
    macKey: MacKey,
    message: string,
    mac: string,
  ): Promise<boolean> {
    const expected = base64ToUint8Array(
      await this.createEnvelopeMac(macKey, message),
    )
    let actual: Uint8Array
    try {
      actual = base64ToUint8Array(mac)
    } catch {
      return false
    }
    if (actual.length !== expected.length) {
      return false
    }
    // Explicit constant-time compare. A `===` on the base64 strings would leak
    // a prefix-length oracle, and is the kind of thing a reviewer has to take
    // on trust unless it is written out.
    let difference = 0
    for (let index = 0; index < expected.length; index++) {
      difference |= expected[index] ^ actual[index]
    }
    return difference === 0
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
    const key = await webcrypto.subtle.importKey(
      'raw',
      base64ToUint8Array(symmetricKey),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    )
    const nonce = webcrypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES))
    // WebCrypto appends the 16-byte tag to the ciphertext itself, so the
    // envelope's second field already is ciphertext || tag.
    const encrypted = await webcrypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: stringToUint8Array(aad),
        tagLength: 128,
      },
      key,
      stringToUint8Array(plainText),
    )
    const result = [
      V2_ENVELOPE_PREFIX,
      uint8ArrayToBase64(nonce),
      uint8ArrayToBase64(new Uint8Array(encrypted)),
    ]
    return result.join(':') as Encrypted<T>
  }

  /**
   * @inheritdoc
   */
  async decryptSymmetric<T extends string>(
    symmetricKey: SymmetricKey,
    encryptedText: Encrypted<T>,
    aad: string,
  ) {
    const parts = encryptedText.split(':')
    if (parts.length !== 3 || parts[0] !== V2_ENVELOPE_PREFIX) {
      // A storage version 1 envelope -- base64(iv):base64(ct), AES-256-CBC --
      // reaching here is a bug or an attack. Nothing in the library reads that
      // format any more, and the shape is refused rather than attempted, which
      // is what keeps the CBC padding oracle off the sync path.
      throw new CryptoError('Could not decrypt data')
    }
    const [, nonceString, encryptedData] = parts

    try {
      const key = await webcrypto.subtle.importKey(
        'raw',
        base64ToUint8Array(symmetricKey),
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
      )
      const decrypted = await webcrypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: base64ToUint8Array(nonceString),
          additionalData: stringToUint8Array(aad),
          tagLength: 128,
        },
        key,
        base64ToUint8Array(encryptedData),
      )
      return uint8ArrayToString(decrypted) as T
    } catch {
      // Deliberately one message for every cause -- bad tag, bad nonce, bad
      // aad, malformed base64, wrong key. A decrypt that distinguishes them is
      // an oracle.
      throw new CryptoError('Could not decrypt data')
    }
  }

  /**
   * @inheritdoc
   */
  async createSymmetricKey(): Promise<SymmetricKey> {
    const key = await webcrypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
    const exportedKey = await webcrypto.subtle.exportKey('raw', key)
    return uint8ArrayToBase64(new Uint8Array(exportedKey)) as SymmetricKey
  }

  /**
   * @inheritdoc
   */
  async createSyncKey(
    combinedKey: Uint8Array,
    responderDeviceId: string,
  ): Promise<SyncKey> {
    const key = await argon2id({
      password: combinedKey,
      salt: responderDeviceId,
      parallelism: SYNC_KDF_PARAMETERS.parallelism,
      iterations: SYNC_KDF_PARAMETERS.iterations,
      memorySize: SYNC_KDF_PARAMETERS.memorySize,
      hashLength: 32,
      outputType: 'binary',
    })
    return uint8ArrayToBase64(key) as SyncKey
  }
}

export default BrowserCryptoLib
