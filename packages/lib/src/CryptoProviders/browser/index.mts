import forge from 'node-forge'
import { Buffer } from 'buffer'
import type CryptoLib from '../../interfaces/CryptoLib.js'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  PassphraseHash,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
} from '../../interfaces/CryptoLib.js'
import { argon2id } from 'hash-wasm'

function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

const generatePassphraseHash = (
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
    const salt = Buffer.from(
      window.crypto.getRandomValues(new Uint8Array(16)),
    ).toString('base64') as Salt

    // create passwordHash
    const passphraseHash = await generatePassphraseHash(salt, passphrase)

    const { encryptedPrivateKey, publicKey } =
      await this.createKeyPair(passphraseHash)
    const symmetricKey = await this.generateSymmetricKey()
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
        throw new Error('Invalid passphrase')
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
      if (err instanceof Error) {
        if (err.message === 'Invalid passphrase') {
          throw new Error('Invalid passphrase')
        }
        if (err.message.includes('Unsupported private key')) {
          throw new Error('Invalid private key')
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
    const buffer = Buffer.from(plainText, 'utf8')
    const encrypted = publicKeyObj.encrypt(
      buffer.toString('binary'),
      'RSA-OAEP',
    )
    return Promise.resolve(Buffer.from(encrypted, 'binary').toString('base64'))
  }

  async decrypt(
    privateKey: PrivateKey,
    encryptedText: string,
  ): Promise<string> {
    const privateKeyObj = forge.pki.privateKeyFromPem(privateKey as string)
    const buffer = Buffer.from(encryptedText, 'base64')
    const decrypted = privateKeyObj.decrypt(
      buffer.toString('binary'),
      'RSA-OAEP',
    )
    return Promise.resolve(Buffer.from(decrypted, 'binary').toString('utf8'))
  }

  private async generateSymmetricKey(): Promise<SymmetricKey> {
    const key = await window.crypto.subtle.generateKey(
      { name: 'AES-CBC', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
    const exportedKey = await window.crypto.subtle.exportKey('raw', key)
    return Buffer.from(exportedKey).toString('base64') as SymmetricKey
  }

  async encryptSymmetric(
    symmetricKey: SymmetricKey,
    plainText: string,
  ): Promise<string> {
    const key = await window.crypto.subtle.importKey(
      'raw',
      Buffer.from(symmetricKey, 'base64'),
      { name: 'AES-CBC', length: 256 },
      false,
      ['encrypt'],
    )
    const iv = window.crypto.getRandomValues(new Uint8Array(16))
    const encryptedBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      key,
      Buffer.from(plainText, 'utf8'),
    )
    const encryptedArray = new Uint8Array(encryptedBuffer)
    const result = [
      Buffer.from(iv).toString('base64'),
      Buffer.from(encryptedArray).toString('base64'),
    ]
    return result.join(':')
  }

  async decryptSymmetric(
    symmetricKey: SymmetricKey,
    encryptedText: string,
  ): Promise<string> {
    const [ivString, encryptedData] = encryptedText.split(':')
    const iv = Buffer.from(ivString, 'base64')
    const keyBuffer = Buffer.from(symmetricKey, 'base64')

    const key = await window.crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-CBC', length: 256 },
      false,
      ['decrypt'],
    )

    const encryptedBuffer = Buffer.from(encryptedData, 'base64')
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-CBC', iv },
      key,
      encryptedBuffer,
    )

    return Buffer.from(decryptedBuffer).toString('utf8')
  }

  async getRandomBytes(count: number) {
    return Promise.resolve(window.crypto.getRandomValues(new Uint8Array(count)))
  }
}

export default BrowserCryptoLib
