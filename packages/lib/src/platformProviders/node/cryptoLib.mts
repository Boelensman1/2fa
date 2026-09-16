/* eslint no-restricted-globals: ["error", "Error"] */
import { promisify } from 'node:util'
import {
  generateKeyPair as generateKeyPairCb,
  generateKey as generateKeyCb,
  hkdf as hkdfCb,
  publicEncrypt,
  privateDecrypt,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  timingSafeEqual,
  constants,
  KeyObject,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto'
import { argon2id } from 'hash-wasm'
import { toUint8Array } from 'uint8array-extras'

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
import { generatePasswordHash } from '../browser/cryptoLib.mjs'

const generateKeyPair = promisify(generateKeyPairCb)
const generateKey = promisify(generateKeyCb)
const hkdf = promisify(hkdfCb)

/** See the browser provider: GCM nonces are 12 bytes, not the v1 path's 16. */
const GCM_NONCE_BYTES = 12

/** The AES-GCM authentication tag length, in bytes. */
const GCM_TAG_BYTES = 16

/** Marks a storage version 2 ciphertext envelope. */
const V2_ENVELOPE_PREFIX = 'v2'

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

    // Generate public/private key pair, unencrypted: the plaintext private key
    // is what the library runs on, and the encrypted form is derived from it
    // below.
    const { publicKey, privateKey } = await generateKeyPair('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    })

    const encryptedPrivateKey = createPrivateKey({
      key: privateKey,
      format: 'pem',
    }).export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: passwordHash,
    }) as EncryptedPrivateKey

    // Create and encrypt symmetric key with public key
    const symmetricKey = await this.createSymmetricKey()
    const encryptedSymmetricKey = await this.encrypt(
      publicKey as PublicKey,
      symmetricKey,
    )
    const macKey = await this.deriveEnvelopeMacKey(passwordHash, salt)

    return {
      privateKey: privateKey as PrivateKey,
      symmetricKey,
      publicKey: publicKey as PublicKey,
      salt: salt,
      encryptedPrivateKey,
      encryptedSymmetricKey: encryptedSymmetricKey as EncryptedSymmetricKey,
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

    // Encrypt private key
    const privateKeyObject = createPrivateKey({
      key: privateKey,
      format: 'pem',
    })
    const encryptedPrivateKey = privateKeyObject.export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: passwordHash,
    }) as EncryptedPrivateKey

    // Encrypt symmetric key with public key
    const publicKeyObject = createPublicKey(privateKeyObject)
    const publicKey = publicKeyObject.export({
      type: 'spki',
      format: 'pem',
    }) as PublicKey
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

    const { privateKey, publicKey } = this.unwrapPrivateKey(
      encryptedPrivateKey,
      passwordHash,
    )

    // Decrypt the symmetric key
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

    const { privateKey, publicKey } = this.unwrapPrivateKey(
      encryptedPrivateKey,
      passwordHash,
    )

    // v1 wrapped the symmetric key with RSA-OAEP/MGF1-SHA-1, which is node's
    // default OAEP hash -- hence no oaepHash here, unlike decrypt().
    const symmetricKey = privateDecrypt(
      { key: privateKey },
      Buffer.from(encryptedSymmetricKey, 'base64'),
    ).toString('utf8') as SymmetricKey

    return { privateKey, publicKey, symmetricKey }
  }

  /**
   * @inheritdoc
   */
  async deriveEnvelopeMacKey(
    passwordHash: PasswordHash,
    salt: Salt,
  ): Promise<MacKey> {
    // Buffer.from(hash, 'hex'), NOT 'utf8': the input keying material is the
    // 64 bytes the hash represents, not the 128 characters it is printed as.
    // Both readings "work" in isolation and diverge silently between
    // providers, so this line is the cross-provider contract.
    const ikm = Buffer.from(passwordHash, 'hex')
    const bits = await hkdf(
      'sha256',
      ikm,
      Buffer.from(salt, 'utf8'),
      Buffer.from('favalib:envelope-mac:v2', 'utf8'),
      32,
    )
    return Buffer.from(bits).toString('base64') as MacKey
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
    const buffer = Buffer.from(plainText, 'utf8')
    // oaepHash sets BOTH the label digest and MGF1, unlike node-forge, which
    // takes them separately. See the browser provider's oaepSha256Options.
    const encrypted = publicEncrypt(
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      buffer,
    )
    return Promise.resolve(encrypted.toString('base64') as Encrypted<T>)
  }

  /**
   * @inheritdoc
   */
  async decrypt<T extends string>(
    privateKey: PrivateKey,
    encryptedText: Encrypted<T>,
  ) {
    const buffer = Buffer.from(encryptedText, 'base64')
    const decrypted = privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      buffer,
    )
    return Promise.resolve(decrypted.toString('utf8') as T)
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
      // A v1 envelope reaching here is a bug or an attack, never a migration:
      // the v1 reader is decryptSymmetricV1 and only the load path may call it.
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
  async decryptSymmetricV1<T extends string>(
    symmetricKey: SymmetricKey,
    encryptedText: Encrypted<T>,
  ) {
    const [ivString, encryptedData] = encryptedText.split(':')
    const iv = Buffer.from(ivString, 'base64')
    const keyBuffer = Buffer.from(symmetricKey, 'base64')
    const decipher = createDecipheriv('aes-256-cbc', keyBuffer, iv)
    let decrypted = decipher.update(encryptedData, 'base64', 'utf8')
    decrypted += decipher.final('utf8')
    return Promise.resolve(decrypted as T)
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
      parallelism: V1_KDF_PARAMETERS.parallelism,
      iterations: V1_KDF_PARAMETERS.iterations,
      memorySize: V1_KDF_PARAMETERS.memorySize,
      hashLength: 32,
      outputType: 'binary',
    })
    return Buffer.from(keyBuffer).toString('base64') as SyncKey
  }

  /**
   * Unwraps the PBES2-encrypted private key and recovers the public key from
   * it. Shared by decryptKeys and decryptKeysV1, which differ only in the
   * argon2 parameters that produced the passphrase and in how the symmetric
   * key is unwrapped afterwards.
   * @param encryptedPrivateKey - The stored, encrypted private key
   * @param passwordHash - The argon2id hash used as the PKCS#8 passphrase
   * @returns The plaintext private key and its public key
   * @throws {CryptoError} If the password or the key is not usable.
   */
  private unwrapPrivateKey(
    encryptedPrivateKey: EncryptedPrivateKey,
    passwordHash: PasswordHash,
  ): { privateKey: PrivateKey; publicKey: PublicKey } {
    let privateKeyObject: KeyObject
    let privateKey: PrivateKey
    try {
      privateKeyObject = createPrivateKey({
        key: encryptedPrivateKey,
        type: 'pkcs8',
        format: 'pem',
        passphrase: passwordHash,
      })
      privateKey = privateKeyObject.export({
        type: 'pkcs8',
        format: 'pem',
      }) as PrivateKey
    } catch (err) {
      // eslint-disable-next-line no-restricted-globals
      if (err instanceof Error && 'code' in err) {
        if (err.code === 'ERR_OSSL_BAD_DECRYPT') {
          throw new CryptoError('Invalid password')
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

    return { privateKey, publicKey }
  }
}

export default NodeCryptoLib
