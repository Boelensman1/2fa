import forge from 'node-forge'
import {
  base64ToUint8Array,
  stringToUint8Array,
  uint8ArrayToBase64,
  uint8ArrayToString,
} from 'uint8array-extras'
import { argon2id } from 'hash-wasm'

import { CryptoError } from '../../TwoFALibError.mjs'
import type CryptoLib from '../../interfaces/CryptoLib.mjs'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  PassphraseHash,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
  SyncKey,
} from '../../interfaces/CryptoLib.mjs'

const normalizeLineEndings = (str: string): string => {
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export const generatePassphraseHash = (
  salt: Salt,
  passphrase: string,
): Promise<PassphraseHash> => {
  return argon2id({
    password: passphrase,
    salt,
    parallelism: 1,
    iterations: 256,
    memorySize: 512,
    hashLength: 64,
    outputType: 'hex',
  }) as Promise<PassphraseHash>
}

class BrowserCryptoLib implements CryptoLib {
  async createKeys(passphrase: Passphrase) {
    // create random salt
    const salt = uint8ArrayToBase64(
      window.crypto.getRandomValues(new Uint8Array(16)),
    ) as Salt

    // create passwordHash
    const passphraseHash = await generatePassphraseHash(salt, passphrase)

    const { encryptedPrivateKey, publicKey } =
      await this.createKeyPair(passphraseHash)
    const symmetricKey = await this.createSymmetricKey()
    const encryptedSymmetricKey = await this.encrypt(publicKey, symmetricKey)

    return {
      encryptedPrivateKey,
      encryptedSymmetricKey: encryptedSymmetricKey as EncryptedSymmetricKey,
      salt,
      publicKey,
    }
  }

  async decryptKeys(
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    passphrase: Passphrase,
  ) {
    // recreate passwordHash
    const passphraseHash = await generatePassphraseHash(salt, passphrase)

    const { privateKey, publicKey } = await this.decryptPrivateKey(
      encryptedPrivateKey,
      passphraseHash,
    )
    const symmetricKey = (await this.decrypt(
      privateKey,
      encryptedSymmetricKey,
    )) as SymmetricKey

    return { privateKey, publicKey, symmetricKey }
  }

  async encryptKeys(
    privateKey: PrivateKey,
    symmetricKey: SymmetricKey,
    salt: Salt,
    passphrase: Passphrase,
  ) {
    // recreate passwordHash
    const passphraseHash = await generatePassphraseHash(salt, passphrase)

    const encryptedPrivateKey = await this.encryptPrivateKey(
      privateKey,
      passphraseHash,
    )
    const publicKey = await this.getPublicKeyFromPrivateKey(privateKey)
    const encryptedSymmetricKey = await this.encrypt(publicKey, symmetricKey)

    return {
      encryptedPrivateKey,
      encryptedSymmetricKey: encryptedSymmetricKey as EncryptedSymmetricKey,
    }
  }

  private async createKeyPair(passphrase: string): Promise<{
    encryptedPrivateKey: EncryptedPrivateKey
    publicKey: PublicKey
  }> {
    return new Promise((resolve, reject) => {
      forge.pki.rsa.generateKeyPair({ bits: 4096 }, (err, keyPair) => {
        if (err) {
          reject(err)
        } else {
          const publicKey = forge.pki.publicKeyToPem(keyPair.publicKey)
          const encryptedPrivateKey = forge.pki.encryptRsaPrivateKey(
            keyPair.privateKey,
            passphrase,
            {
              algorithm: 'aes256',
            },
          ) as EncryptedPrivateKey
          resolve({
            encryptedPrivateKey,
            publicKey: normalizeLineEndings(publicKey) as PublicKey,
          })
        }
      })
    })
  }

  private async decryptPrivateKey(
    encryptedPrivateKey: EncryptedPrivateKey,
    passphraseHash: PassphraseHash,
  ): Promise<{ privateKey: PrivateKey; publicKey: PublicKey }> {
    try {
      const privateKeyPem = forge.pki.decryptRsaPrivateKey(
        encryptedPrivateKey,
        passphraseHash,
      )
      if (!privateKeyPem) {
        throw new CryptoError('Invalid passphrase')
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
        if (err.message === 'Invalid passphrase') {
          throw new CryptoError('Invalid passphrase')
        }
        if (err.message.includes('Unsupported private key')) {
          throw new CryptoError('Invalid private key')
        }
      }
      throw err
    }
  }

  private async encryptPrivateKey(
    privateKey: PrivateKey,
    passphraseHash: PassphraseHash,
  ): Promise<EncryptedPrivateKey> {
    const privateKeyObj = forge.pki.privateKeyFromPem(privateKey as string)
    const encryptedPrivateKey = forge.pki.encryptRsaPrivateKey(
      privateKeyObj,
      passphraseHash,
      {
        algorithm: 'aes256',
      },
    ) as EncryptedPrivateKey
    return Promise.resolve(encryptedPrivateKey)
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

  async encrypt(publicKey: PublicKey, plainText: string): Promise<string> {
    const publicKeyObj = forge.pki.publicKeyFromPem(publicKey as string)
    const encrypted = publicKeyObj.encrypt(plainText, 'RSA-OAEP')
    return Promise.resolve(btoa(encrypted))
  }

  async decrypt(
    privateKey: PrivateKey,
    encryptedTextB64: string,
  ): Promise<string> {
    const privateKeyObj = forge.pki.privateKeyFromPem(privateKey as string)
    const decrypted = privateKeyObj.decrypt(atob(encryptedTextB64), 'RSA-OAEP')
    return Promise.resolve(decrypted)
  }

  async createSymmetricKey(): Promise<SymmetricKey> {
    const key = await window.crypto.subtle.generateKey(
      { name: 'AES-CBC', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
    const exportedKey = await window.crypto.subtle.exportKey('raw', key)
    return uint8ArrayToBase64(new Uint8Array(exportedKey)) as SymmetricKey
  }

  async encryptSymmetric(
    symmetricKey: SymmetricKey,
    plainText: string,
  ): Promise<string> {
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
    return result.join(':')
  }

  async decryptSymmetric(
    symmetricKey: SymmetricKey,
    encryptedText: string,
  ): Promise<string> {
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

    return uint8ArrayToString(decrypted)
  }

  async getRandomBytes(count: number) {
    return Promise.resolve(window.crypto.getRandomValues(new Uint8Array(count)))
  }

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
}

export default BrowserCryptoLib
