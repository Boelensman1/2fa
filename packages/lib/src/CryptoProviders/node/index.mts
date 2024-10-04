import { promisify } from 'node:util'
import {
  generateKeyPair as generateKeyPairCb,
  generateKey as generateKeyCb,
  publicEncrypt,
  privateDecrypt,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto'
import { argon2id } from 'hash-wasm'

import { CryptoError } from '../../TwoFALibError.mjs'
import type CryptoLib from '../../interfaces/CryptoLib.mjs'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
  SyncKey,
} from '../../interfaces/CryptoLib.mjs'

const generateKeyPair = promisify(generateKeyPairCb)
const generateKey = promisify(generateKeyCb)

const generatePassphraseHash = (salt: Salt, passphrase: string) => {
  return argon2id({
    password: passphrase,
    salt,
    parallelism: 1,
    iterations: 256,
    memorySize: 512,
    hashLength: 64,
    outputType: 'hex',
  })
}

class NodeCryptoLib implements CryptoLib {
  async createKeys(passphrase: Passphrase) {
    // create random salt
    const salt = randomBytes(16).toString('base64') as Salt

    // create passwordHash
    const passphraseHash = await generatePassphraseHash(salt, passphrase)

    // Generate public/private key pair
    const { publicKey, privateKey: encryptedPrivateKey } =
      await generateKeyPair('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem',
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem',
          cipher: 'aes-256-cbc',
          passphrase: passphraseHash,
        },
      })

    // Generate symmetric key
    const symmetricKey = await generateKey('aes', { length: 256 })
    const exportedSymmetricKey = symmetricKey
      .export()
      .toString('base64') as SymmetricKey

    // Encrypt symmetric key with public key
    const encryptedSymmetricKey = await this.encrypt(
      publicKey as PublicKey,
      exportedSymmetricKey,
    )

    return {
      publicKey: publicKey as PublicKey,
      salt: salt,
      encryptedPrivateKey: encryptedPrivateKey as EncryptedPrivateKey,
      encryptedSymmetricKey: encryptedSymmetricKey as EncryptedSymmetricKey,
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

    let privateKeyObject: KeyObject
    let privateKey: PrivateKey
    try {
      privateKeyObject = createPrivateKey({
        key: encryptedPrivateKey,
        type: 'pkcs8',
        format: 'pem',
        passphrase: passphraseHash,
      })
      privateKey = privateKeyObject.export({
        type: 'pkcs8',
        format: 'pem',
      }) as PrivateKey
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        if (err.code === 'ERR_OSSL_BAD_DECRYPT') {
          throw new CryptoError('Invalid passphrase')
        }
        if (err.code === 'ERR_OSSL_UNSUPPORTED') {
          throw new CryptoError('Invalid private key')
        }
      }
      throw err
    }
    const publicKeyObject = createPublicKey(privateKeyObject)
    const publicKey = publicKeyObject.export({
      type: 'spki',
      format: 'pem',
    }) as PublicKey

    // Decrypt the symmetric key
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

    // Encrypt private key
    const privateKeyObject = createPrivateKey({
      key: privateKey,
      format: 'pem',
    })
    const encryptedPrivateKey = privateKeyObject.export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: passphraseHash,
    }) as EncryptedPrivateKey

    // Encrypt symmetric key with public key
    const publicKeyObject = createPublicKey(privateKeyObject)
    const publicKey = publicKeyObject.export({
      type: 'spki',
      format: 'pem',
    }) as PublicKey
    const encryptedSymmetricKey = await this.encrypt(publicKey, symmetricKey)

    return {
      encryptedPrivateKey,
      encryptedSymmetricKey: encryptedSymmetricKey as EncryptedSymmetricKey,
    }
  }

  async encrypt(publicKey: PublicKey, plainText: string) {
    const buffer = Buffer.from(plainText, 'utf8')
    const encrypted = publicEncrypt(publicKey, buffer)
    return Promise.resolve(encrypted.toString('base64'))
  }

  async decrypt(privateKey: PrivateKey, encryptedText: string) {
    const buffer = Buffer.from(encryptedText, 'base64')
    const decrypted = privateDecrypt(
      {
        key: privateKey,
      },
      buffer,
    )
    return Promise.resolve(decrypted.toString('utf8'))
  }

  async encryptSymmetric(symmetricKey: SymmetricKey, plainText: string) {
    const iv = randomBytes(16)
    const keyBuffer = Buffer.from(symmetricKey, 'base64')
    const cipher = createCipheriv('aes-256-cbc', keyBuffer, iv)
    let encrypted = cipher.update(plainText, 'utf8', 'base64')
    encrypted += cipher.final('base64')
    return Promise.resolve(iv.toString('base64') + ':' + encrypted)
  }

  async decryptSymmetric(symmetricKey: SymmetricKey, encryptedText: string) {
    const [ivString, encryptedData] = encryptedText.split(':')
    const iv = Buffer.from(ivString, 'base64')
    const keyBuffer = Buffer.from(symmetricKey, 'base64')
    const decipher = createDecipheriv('aes-256-cbc', keyBuffer, iv)
    let decrypted = decipher.update(encryptedData, 'base64', 'utf8')
    decrypted += decipher.final('utf8')
    return Promise.resolve(decrypted)
  }

  async getRandomBytes(count: number) {
    return Promise.resolve(randomBytes(count))
  }

  async createSyncKey(sharedKey: Uint8Array, salt: string): Promise<SyncKey> {
    const keyBuffer = await argon2id({
      password: sharedKey,
      salt,
      parallelism: 1,
      iterations: 256,
      memorySize: 512,
      hashLength: 32,
      outputType: 'binary',
    })
    return Buffer.from(keyBuffer).toString('base64') as SyncKey
  }
}

export default NodeCryptoLib
