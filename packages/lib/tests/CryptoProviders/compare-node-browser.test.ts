import { describe, expect, test } from 'vitest'
import crypto from 'node:crypto'
import {
  CryptoLib,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  PublicKey,
  PrivateKey,
  SymmetricKey,
  Passphrase,
  Salt,
} from '../../src/main.mjs'

import NodeCryptoProvider from '../../src/CryptoProviders/node/index.mjs'
import BrowserCryptoProvider from '../../src/CryptoProviders/browser/index.mjs'

// @ts-expect-error node crypto and webcrypto don't have the exact same types
globalThis.window = { crypto: crypto.webcrypto }

describe('Crypto Provider Comparison', () => {
  const nodeCrypto = new NodeCryptoProvider()
  const browserCrypto = new BrowserCryptoProvider()
  const testPassphrase = 'testPassphrase123' as Passphrase
  const testMessage = 'Hello, World!'

  const runTests = (crypto: CryptoLib, name: string) => {
    let encryptedPrivateKey: EncryptedPrivateKey
    let encryptedSymmetricKey: EncryptedSymmetricKey
    let publicKey: PublicKey
    let privateKey: PrivateKey
    let symmetricKey: SymmetricKey
    let salt: Salt

    test(`${name}: full encryption cycle`, async () => {
      // Create keys
      const keyResult = await crypto.createKeys(testPassphrase)
      encryptedPrivateKey = keyResult.encryptedPrivateKey
      encryptedSymmetricKey = keyResult.encryptedSymmetricKey
      publicKey = keyResult.publicKey
      salt = keyResult.salt
      expect(encryptedPrivateKey).toBeTruthy()
      expect(encryptedSymmetricKey).toBeTruthy()
      expect(publicKey).toBeTruthy()
      expect(salt).toBeTruthy()

      // Decrypt keys
      const decryptResult = await crypto.decryptKeys(
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        testPassphrase,
      )
      privateKey = decryptResult.privateKey
      symmetricKey = decryptResult.symmetricKey
      expect(privateKey).toBeTruthy()
      expect(symmetricKey).toBeTruthy()
      expect(decryptResult.publicKey).toEqual(publicKey)

      // Re-encrypt keys
      const reEncrypted = await crypto.encryptKeys(
        privateKey,
        symmetricKey,
        salt,
        testPassphrase,
      )
      expect(reEncrypted.encryptedPrivateKey).toBeTruthy()
      expect(reEncrypted.encryptedSymmetricKey).toBeTruthy()
      expect(reEncrypted.encryptedPrivateKey).not.toEqual(privateKey)
      expect(reEncrypted.encryptedSymmetricKey).not.toEqual(symmetricKey)

      // Asymmetric encryption and decryption
      const encrypted = await crypto.encrypt(publicKey, testMessage)
      expect(encrypted).toBeTruthy()
      expect(encrypted).not.toEqual(testMessage)

      const decrypted = await crypto.decrypt(privateKey, encrypted)
      expect(decrypted).toEqual(testMessage)

      // Symmetric encryption and decryption
      const symmetricEncrypted = await crypto.encryptSymmetric(
        symmetricKey,
        testMessage,
      )
      expect(symmetricEncrypted).toBeTruthy()
      expect(symmetricEncrypted).not.toEqual(testMessage)

      const symmetricDecrypted = await crypto.decryptSymmetric(
        symmetricKey,
        symmetricEncrypted,
      )
      expect(symmetricDecrypted).toEqual(testMessage)
    })

    return {
      getKeys: () => ({
        encryptedPrivateKey,
        encryptedSymmetricKey,
        publicKey,
        privateKey,
        symmetricKey,
        salt,
      }),
    }
  }

  describe('NodeCryptoLib', () => {
    const nodeTest = runTests(nodeCrypto, 'NodeCryptoLib')

    test('Keys are properly set after test', () => {
      const {
        encryptedPrivateKey,
        encryptedSymmetricKey,
        publicKey,
        privateKey,
        symmetricKey,
      } = nodeTest.getKeys()
      expect(encryptedPrivateKey).toBeTruthy()
      expect(encryptedSymmetricKey).toBeTruthy()
      expect(publicKey).toBeTruthy()
      expect(privateKey).toBeTruthy()
      expect(symmetricKey).toBeTruthy()
    })
  })

  describe('BrowserCryptoLib', () => {
    const browserTest = runTests(browserCrypto, 'BrowserCryptoLib')

    test('Keys are properly set after test', () => {
      const {
        encryptedPrivateKey,
        encryptedSymmetricKey,
        publicKey,
        privateKey,
        symmetricKey,
      } = browserTest.getKeys()
      expect(encryptedPrivateKey).toBeTruthy()
      expect(encryptedSymmetricKey).toBeTruthy()
      expect(publicKey).toBeTruthy()
      expect(privateKey).toBeTruthy()
      expect(symmetricKey).toBeTruthy()
    })
  })

  describe('Cross-provider compatibility', () => {
    const nodeTest = runTests(nodeCrypto, 'NodeCryptoLib')
    const browserTest = runTests(browserCrypto, 'BrowserCryptoLib')

    test('Node can decrypt Browser-encrypted keys', async () => {
      const {
        encryptedPrivateKey: browserEncryptedPrivateKey,
        encryptedSymmetricKey: browserEncryptedSymmetricKey,
        publicKey: browserPublicKey,
        salt: browserSalt,
      } = browserTest.getKeys()
      const result = await nodeCrypto.decryptKeys(
        browserEncryptedPrivateKey,
        browserEncryptedSymmetricKey,
        browserSalt,
        testPassphrase,
      )
      expect(result.privateKey).toBeTruthy()
      expect(result.symmetricKey).toBeTruthy()
      expect(result.publicKey).toBe(browserPublicKey)
    })

    test('Browser can decrypt Node-encrypted keys', async () => {
      const {
        encryptedPrivateKey: nodeEncryptedPrivateKey,
        encryptedSymmetricKey: nodeEncryptedSymmetricKey,
        publicKey: nodePublicKey,
        salt: nodeSalt,
      } = nodeTest.getKeys()
      const result = await browserCrypto.decryptKeys(
        nodeEncryptedPrivateKey,
        nodeEncryptedSymmetricKey,
        nodeSalt,
        testPassphrase,
      )
      expect(result.privateKey).toBeTruthy()
      expect(result.symmetricKey).toBeTruthy()
      expect(result.publicKey).toBe(nodePublicKey)
    })

    test('Node can encrypt with Browser public key and Browser can decrypt', async () => {
      const { publicKey: browserPublicKey, privateKey: browserPrivateKey } =
        browserTest.getKeys()
      const encrypted = await nodeCrypto.encrypt(browserPublicKey, testMessage)
      const decrypted = await browserCrypto.decrypt(
        browserPrivateKey,
        encrypted,
      )
      expect(decrypted).toEqual(testMessage)
    })

    test('Browser can encrypt with Node public key and Node can decrypt', async () => {
      const { publicKey: nodePublicKey, privateKey: nodePrivateKey } =
        nodeTest.getKeys()
      const encrypted = await browserCrypto.encrypt(nodePublicKey, testMessage)
      const decrypted = await nodeCrypto.decrypt(nodePrivateKey, encrypted)
      expect(decrypted).toEqual(testMessage)
    })

    test('Node can encrypt with symmetric key and Browser can decrypt', async () => {
      const { symmetricKey: nodeSymmetricKey } = nodeTest.getKeys()
      const encrypted = await nodeCrypto.encryptSymmetric(
        nodeSymmetricKey,
        testMessage,
      )
      const decrypted = await browserCrypto.decryptSymmetric(
        nodeSymmetricKey,
        encrypted,
      )
      expect(decrypted).toEqual(testMessage)
    })

    test('Browser can encrypt with symmetric key and Node can decrypt', async () => {
      const { symmetricKey: browserSymmetricKey } = browserTest.getKeys()
      const encrypted = await browserCrypto.encryptSymmetric(
        browserSymmetricKey,
        testMessage,
      )
      const decrypted = await nodeCrypto.decryptSymmetric(
        browserSymmetricKey,
        encrypted,
      )
      expect(decrypted).toEqual(testMessage)
    })

    test('Node and Browser createSyncKey produce the same result', async () => {
      const sharedKey = new Uint8Array([1, 2, 3, 4, 5])
      const salt = 'testSalt'

      const nodeSyncKey = await nodeCrypto.createSyncKey(sharedKey, salt)
      const browserSyncKey = await browserCrypto.createSyncKey(sharedKey, salt)

      expect(nodeSyncKey).toBe(browserSyncKey)
      expect(nodeSyncKey.length).toBeGreaterThan(0)
    })
  })
})
