import forge from 'node-forge'
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
  Encrypted,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  KdfParameters,
  MacKey,
  Password,
  PasswordHash,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
  SyncKey,
} from '../../interfaces/CryptoLib.mjs'
import { V1_KDF_PARAMETERS, V2_KDF_PARAMETERS } from '../../version.mjs'

/**
 * The AES-GCM nonce length, in bytes. Twelve, not the sixteen the v1 CBC path
 * used: 96 bits is the only length GCM's counter construction handles without
 * an extra GHASH pass, and it is what every implementation agrees on.
 */
const GCM_NONCE_BYTES = 12

/**
 * The prefix that marks a storage version 2 ciphertext envelope.
 *
 * A v1 envelope is `base64(iv) + ":" + base64(ct)`, whose first field is always
 * exactly 24 base64 characters, so the two shapes cannot be confused. The
 * prefix is what makes that explicit rather than inferred.
 */
const V2_ENVELOPE_PREFIX = 'v2'

/**
 * Normalizes line endings in a string so they match the
 * node cryptoprovider format
 * @param str - The input string to normalize.
 * @returns The normalized string with consistent line endings.
 */
const normalizeLineEndings = (str: string): string => {
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * The RSA-OAEP options for storage version 2: MGF1-SHA-256.
 *
 * node-forge takes the label digest and the MGF1 digest SEPARATELY, while
 * node's `oaepHash: 'sha256'` sets both at once. Passing `md` here without
 * `mgf1.md` produces ciphertext that round-trips perfectly within forge and
 * fails only against the node provider, which is exactly the kind of break
 * that reaches users rather than CI. Both are set, and
 * tests/CryptoProviders/compare-node-browser.test.ts asserts the half-migrated
 * combination specifically.
 * @returns Fresh forge message digest objects; they are stateful, so a new
 * pair is needed per call.
 */
const oaepSha256Options = () => ({
  md: forge.md.sha256.create(),
  mgf1: { md: forge.md.sha256.create() },
})

/**
 * Create a password hash
 * @param salt - The salt to use
 * @param password - The password to hash
 * @param parameters - The argon2id cost parameters. Storage version 2 vaults
 * record their own in the LockedRepresentation; version 1 vaults use
 * V1_KDF_PARAMETERS.
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
    return Promise.resolve(window.crypto.getRandomValues(new Uint8Array(count)))
  }

  /**
   * @inheritdoc
   */
  async sha256(data: string): Promise<string> {
    const digest = await window.crypto.subtle.digest(
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
      window.crypto.getRandomValues(new Uint8Array(16)),
    ) as Salt

    // create passwordHash
    const passwordHash = await generatePasswordHash(
      salt,
      password,
      V2_KDF_PARAMETERS,
    )

    const { privateKey, encryptedPrivateKey, publicKey } =
      await this.createKeyPair(passwordHash)
    const symmetricKey = await this.createSymmetricKey()
    const encryptedSymmetricKey = await this.encrypt(publicKey, symmetricKey)
    // Derived from the passwordHash we already have; never a second argon2 run.
    const macKey = await this.deriveEnvelopeMacKey(passwordHash, salt)

    return {
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey: encryptedSymmetricKey as EncryptedSymmetricKey,
      salt,
      publicKey,
      macKey,
      kdf: V2_KDF_PARAMETERS,
    }
  }

  /**
   * @inheritdoc
   */
  async encryptKeys(
    privateKey: PrivateKey,
    symmetricKey: SymmetricKey,
    salt: Salt,
    password: Password,
    kdf: KdfParameters = V2_KDF_PARAMETERS,
  ) {
    // recreate passwordHash
    const passwordHash = await generatePasswordHash(salt, password, kdf)

    const encryptedPrivateKey = await this.encryptPrivateKey(
      privateKey,
      passwordHash,
    )
    const publicKey = await this.getPublicKeyFromPrivateKey(privateKey)
    const encryptedSymmetricKey = await this.encrypt(publicKey, symmetricKey)
    const macKey = await this.deriveEnvelopeMacKey(passwordHash, salt)

    return {
      encryptedPrivateKey,
      encryptedSymmetricKey: encryptedSymmetricKey as EncryptedSymmetricKey,
      macKey,
    }
  }

  /**
   * @inheritdoc
   */
  async decryptKeys(
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    password: Password,
    kdf: KdfParameters = V2_KDF_PARAMETERS,
  ): Promise<{
    privateKey: PrivateKey
    symmetricKey: SymmetricKey
    publicKey: PublicKey
    macKey: MacKey
  }> {
    // recreate passwordHash
    const passwordHash = await generatePasswordHash(salt, password, kdf)

    const { privateKey, publicKey } = await this.decryptPrivateKey(
      encryptedPrivateKey,
      passwordHash,
    )
    const symmetricKey = await this.decrypt(privateKey, encryptedSymmetricKey)
    // Same passwordHash, no second derivation: at m=64 MiB/t=3/p=4 a second
    // argon2 run would add ~260 ms to every unlock.
    const macKey = await this.deriveEnvelopeMacKey(passwordHash, salt)

    return { privateKey, publicKey, symmetricKey, macKey }
  }

  /**
   * @inheritdoc
   */
  async decryptKeysV1(
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    password: Password,
  ): Promise<{
    privateKey: PrivateKey
    symmetricKey: SymmetricKey
    publicKey: PublicKey
  }> {
    const passwordHash = await generatePasswordHash(
      salt,
      password,
      V1_KDF_PARAMETERS,
    )

    const { privateKey, publicKey } = await this.decryptPrivateKey(
      encryptedPrivateKey,
      passwordHash,
    )
    // v1 wrapped the symmetric key with RSA-OAEP/MGF1-SHA-1.
    const privateKeyObj = forge.pki.privateKeyFromPem(privateKey)
    const symmetricKey = privateKeyObj.decrypt(
      atob(encryptedSymmetricKey),
      'RSA-OAEP',
    ) as SymmetricKey

    return { privateKey, publicKey, symmetricKey }
  }

  /**
   * @inheritdoc
   */
  async deriveEnvelopeMacKey(
    passwordHash: PasswordHash,
    salt: Salt,
  ): Promise<MacKey> {
    // hexToUint8Array, NOT stringToUint8Array: the input keying material is
    // the 64 bytes the hash represents, not the 128 characters it is printed
    // as. Both readings "work" in isolation and diverge silently between
    // providers, so this line is the cross-provider contract.
    const ikm = hexToUint8Array(passwordHash)
    const key = await window.crypto.subtle.importKey(
      'raw',
      ikm,
      'HKDF',
      false,
      ['deriveBits'],
    )
    const bits = await window.crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: stringToUint8Array(salt),
        info: stringToUint8Array('favalib:envelope-mac:v2'),
      },
      key,
      256,
    )
    return uint8ArrayToBase64(new Uint8Array(bits)) as MacKey
  }

  /**
   * @inheritdoc
   */
  async createEnvelopeMac(macKey: MacKey, message: string): Promise<string> {
    const key = await window.crypto.subtle.importKey(
      'raw',
      base64ToUint8Array(macKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const mac = await window.crypto.subtle.sign(
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
    const publicKeyObj = forge.pki.publicKeyFromPem(publicKey)
    const encrypted = publicKeyObj.encrypt(
      plainText,
      'RSA-OAEP',
      oaepSha256Options(),
    )
    return Promise.resolve(btoa(encrypted) as Encrypted<T>)
  }

  /**
   * @inheritdoc
   */
  async decrypt<T extends string>(
    privateKey: PrivateKey,
    encryptedText: Encrypted<T>,
  ) {
    const privateKeyObj = forge.pki.privateKeyFromPem(privateKey)
    const decrypted = privateKeyObj.decrypt(
      atob(encryptedText),
      'RSA-OAEP',
      oaepSha256Options(),
    )
    return Promise.resolve(decrypted as T)
  }

  /**
   * @inheritdoc
   */
  async encryptSymmetric<T extends string>(
    symmetricKey: SymmetricKey,
    plainText: T,
    aad: string,
  ) {
    const key = await window.crypto.subtle.importKey(
      'raw',
      base64ToUint8Array(symmetricKey),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    )
    const nonce = window.crypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES))
    // WebCrypto appends the 16-byte tag to the ciphertext itself, so the
    // envelope's second field already is ciphertext || tag.
    const encrypted = await window.crypto.subtle.encrypt(
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
      // A v1 envelope reaching here is a bug or an attack, never a migration:
      // the v1 reader is decryptSymmetricV1 and only the load path may call it.
      throw new CryptoError('Could not decrypt data')
    }
    const [, nonceString, encryptedData] = parts

    try {
      const key = await window.crypto.subtle.importKey(
        'raw',
        base64ToUint8Array(symmetricKey),
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
      )
      const decrypted = await window.crypto.subtle.decrypt(
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
      // the oracle 02-ciphertext-authenticity.md is about.
      throw new CryptoError('Could not decrypt data')
    }
  }

  /**
   * @inheritdoc
   */
  async decryptSymmetricV1<T extends string>(
    symmetricKey: SymmetricKey,
    encryptedText: Encrypted<T>,
  ) {
    const [ivString, encryptedData] = encryptedText.split(':')
    const iv = base64ToUint8Array(ivString)
    const keyUint8Array = base64ToUint8Array(symmetricKey)

    const key = await window.crypto.subtle.importKey(
      'raw',
      keyUint8Array,
      { name: 'AES-CBC', length: 256 },
      false,
      ['decrypt'],
    )

    const encrypted = base64ToUint8Array(encryptedData)
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-CBC', iv },
      key,
      encrypted,
    )

    return uint8ArrayToString(decrypted) as T
  }

  /**
   * @inheritdoc
   */
  async createSymmetricKey(): Promise<SymmetricKey> {
    const key = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
    const exportedKey = await window.crypto.subtle.exportKey('raw', key)
    return uint8ArrayToBase64(new Uint8Array(exportedKey)) as SymmetricKey
  }

  /**
   * @inheritdoc
   */
  async createSyncKey(sharedKey: Uint8Array, salt: string): Promise<SyncKey> {
    const key = await argon2id({
      password: sharedKey,
      salt,
      parallelism: V1_KDF_PARAMETERS.parallelism,
      iterations: V1_KDF_PARAMETERS.iterations,
      memorySize: V1_KDF_PARAMETERS.memorySize,
      hashLength: 32,
      outputType: 'binary',
    })
    return uint8ArrayToBase64(key) as SyncKey
  }

  private async encryptPrivateKey(
    privateKey: PrivateKey,
    passwordHash: PasswordHash,
  ): Promise<EncryptedPrivateKey> {
    const privateKeyObj = forge.pki.privateKeyFromPem(privateKey)
    const encryptedPrivateKey = forge.pki.encryptRsaPrivateKey(
      privateKeyObj,
      passwordHash,
      {
        algorithm: 'aes256',
      },
    ) as EncryptedPrivateKey
    return Promise.resolve(encryptedPrivateKey)
  }

  private async decryptPrivateKey(
    encryptedPrivateKey: EncryptedPrivateKey,
    passwordHash: PasswordHash,
  ): Promise<{ privateKey: PrivateKey; publicKey: PublicKey }> {
    try {
      const privateKeyPem = forge.pki.decryptRsaPrivateKey(
        encryptedPrivateKey,
        passwordHash,
      )
      if (!privateKeyPem) {
        throw new CryptoError('Invalid password')
      }
      const privateKey = forge.pki.privateKeyToPem(privateKeyPem)
      const publicKey = forge.pki.publicKeyToPem(
        forge.pki.setRsaPublicKey(privateKeyPem.n, privateKeyPem.e),
      )
      return Promise.resolve({
        privateKey: normalizeLineEndings(privateKey) as PrivateKey,
        publicKey: normalizeLineEndings(publicKey) as PublicKey,
      })
    } catch (err) {
      // eslint-disable-next-line no-restricted-globals
      if (err instanceof Error) {
        if (err.message === 'Invalid password') {
          throw new CryptoError('Invalid password')
        }
        if (err.message.includes('Unsupported private key')) {
          throw new CryptoError('Invalid private key')
        }
      }
      throw err
    }
  }

  private async createKeyPair(password: string): Promise<{
    privateKey: PrivateKey
    encryptedPrivateKey: EncryptedPrivateKey
    publicKey: PublicKey
  }> {
    return new Promise((resolve, reject) => {
      forge.pki.rsa.generateKeyPair({ bits: 4096 }, (err, keyPair) => {
        if (err) {
          reject(err)
        } else {
          const publicKey = forge.pki.publicKeyToPem(keyPair.publicKey)
          const privateKey = forge.pki.privateKeyToPem(keyPair.privateKey)
          const encryptedPrivateKey = forge.pki.encryptRsaPrivateKey(
            keyPair.privateKey,
            password,
            {
              algorithm: 'aes256',
            },
          ) as EncryptedPrivateKey

          resolve({
            privateKey: normalizeLineEndings(privateKey) as PrivateKey,
            publicKey: normalizeLineEndings(publicKey) as PublicKey,
            encryptedPrivateKey,
          })
        }
      })
    })
  }

  private async getPublicKeyFromPrivateKey(
    privateKey: PrivateKey,
  ): Promise<PublicKey> {
    const privateKeyObj = forge.pki.privateKeyFromPem(privateKey)
    const publicKey = forge.pki.publicKeyToPem(
      forge.pki.setRsaPublicKey(privateKeyObj.n, privateKeyObj.e),
    )
    return Promise.resolve(normalizeLineEndings(publicKey) as PublicKey)
  }
}

export default BrowserCryptoLib
