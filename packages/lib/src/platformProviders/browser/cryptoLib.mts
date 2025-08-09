import forge from 'node-forge'
import {
  base64ToUint8Array,
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
  Password,
  PasswordHash,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
  SyncKey,
} from '../../interfaces/CryptoLib.mjs'

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
 * Create a password hash
 * @param salt - The salt to use
 * @param password - The password to hash
 * @returns The calculated password hash
 */
export const generatePasswordHash = (
  salt: Salt,
  password: string,
): Promise<PasswordHash> => {
  return argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 256,
    memorySize: 512,
    hashLength: 64,
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
  async createKeys(password: Password) {
    // create random salt
    const salt = uint8ArrayToBase64(
      window.crypto.getRandomValues(new Uint8Array(16)),
    ) as Salt

    // create passwordHash
    const passwordHash = await generatePasswordHash(salt, password)

    const { privateKey, encryptedPrivateKey, publicKey } =
      await this.createKeyPair(passwordHash)
    const symmetricKey = await this.createSymmetricKey()
    const encryptedSymmetricKey = await this.encrypt(publicKey, symmetricKey)

    return {
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey: encryptedSymmetricKey as EncryptedSymmetricKey,
      salt,
      publicKey,
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
  ) {
    // recreate passwordHash
    const passwordHash = await generatePasswordHash(salt, password)

    const encryptedPrivateKey = await this.encryptPrivateKey(
      privateKey,
      passwordHash,
    )
    const publicKey = await this.getPublicKeyFromPrivateKey(privateKey)
    const encryptedSymmetricKey = await this.encrypt(publicKey, symmetricKey)

    return {
      encryptedPrivateKey,
      encryptedSymmetricKey: encryptedSymmetricKey as EncryptedSymmetricKey,
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
  ) {
    // recreate passwordHash
    const passwordHash = await generatePasswordHash(salt, password)

    const { privateKey, publicKey } = await this.decryptPrivateKey(
      encryptedPrivateKey,
      passwordHash,
    )
    const symmetricKey = (await this.decrypt(
      privateKey,
      encryptedSymmetricKey,
    )) as SymmetricKey

    return { privateKey, publicKey, symmetricKey }
  }

  /**
   * @inheritdoc
   */
  async encrypt<T extends string>(publicKey: PublicKey, plainText: T) {
    const publicKeyObj = forge.pki.publicKeyFromPem(publicKey as string)
    const encrypted = publicKeyObj.encrypt(plainText, 'RSA-OAEP')
    return Promise.resolve(btoa(encrypted) as Encrypted<T>)
  }

  /**
   * @inheritdoc
   */
  async decrypt<T extends string>(
    privateKey: PrivateKey,
    encryptedText: Encrypted<T>,
  ) {
    const privateKeyObj = forge.pki.privateKeyFromPem(privateKey as string)
    const decrypted = privateKeyObj.decrypt(atob(encryptedText), 'RSA-OAEP')
    return Promise.resolve(decrypted as T)
  }

  /**
   * @inheritdoc
   */
  async encryptSymmetric<T extends string>(
    symmetricKey: SymmetricKey,
    plainText: T,
  ) {
    const key = await window.crypto.subtle.importKey(
      'raw',
      base64ToUint8Array(symmetricKey),
      { name: 'AES-CBC', length: 256 },
      false,
      ['encrypt'],
    )
    const iv = window.crypto.getRandomValues(new Uint8Array(16))
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      key,
      stringToUint8Array(plainText),
    )
    const result = [
      uint8ArrayToBase64(iv),
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
      { name: 'AES-CBC', length: 256 },
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
      parallelism: 1,
      iterations: 256,
      memorySize: 512,
      hashLength: 32,
      outputType: 'binary',
    })
    return uint8ArrayToBase64(key) as SyncKey
  }

  private async encryptPrivateKey(
    privateKey: PrivateKey,
    passwordHash: PasswordHash,
  ): Promise<EncryptedPrivateKey> {
    const privateKeyObj = forge.pki.privateKeyFromPem(privateKey as string)
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
    const privateKeyObj = forge.pki.privateKeyFromPem(privateKey as string)
    const publicKey = forge.pki.publicKeyToPem(
      forge.pki.setRsaPublicKey(privateKeyObj.n, privateKeyObj.e),
    )
    return Promise.resolve(normalizeLineEndings(publicKey) as PublicKey)
  }
}

export default BrowserCryptoLib
