import { describe, expect, test } from 'vitest'
import crypto from 'node:crypto'
import {
  CryptoLib,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  PublicKey,
  PrivateKey,
  SymmetricKey,
  Password,
  Salt,
  V2_KDF_PARAMETERS,
} from '../../src/main.mjs'
import forge from 'node-forge'

import { nodeProviders } from '../../src/platformProviders/node/index.mjs'
import { browserProviders } from '../../src/platformProviders/browser/index.mjs'

// @ts-expect-error node crypto and webcrypto don't have the exact same types
globalThis.window = { crypto: crypto.webcrypto }

describe('Crypto Provider Comparison', () => {
  const nodeCrypto = new nodeProviders.CryptoLib()
  const browserCrypto = new browserProviders.CryptoLib()
  const testPassword = 'testPassword123' as Password
  const testMessage = 'Hello, World!'
  // Every symmetric operation is bound to additional authenticated data now,
  // so the tests have to carry one too. A constant is enough here: what the
  // cross-provider tests pin is that both providers agree on how the AAD is
  // fed to AES-GCM, not what goes into it -- that is canonical.mts's job.
  const testAad = 'favalib:test:v2'

  const runTests = (crypto: CryptoLib, name: string) => {
    let encryptedPrivateKey: EncryptedPrivateKey
    let encryptedSymmetricKey: EncryptedSymmetricKey
    let publicKey: PublicKey
    let privateKey: PrivateKey
    let symmetricKey: SymmetricKey
    let salt: Salt

    test(`${name}: full encryption cycle`, async () => {
      // Create keys
      const keyResult = await crypto.createKeys(testPassword)
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
        testPassword,
        V2_KDF_PARAMETERS,
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
        testPassword,
        V2_KDF_PARAMETERS,
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
        testAad,
      )
      expect(symmetricEncrypted).toBeTruthy()
      expect(symmetricEncrypted).not.toEqual(testMessage)

      const symmetricDecrypted = await crypto.decryptSymmetric(
        symmetricKey,
        symmetricEncrypted,
        testAad,
      )
      expect(symmetricDecrypted).toEqual(testMessage)

      // A different AAD must not open the same ciphertext.
      await expect(
        crypto.decryptSymmetric(symmetricKey, symmetricEncrypted, 'other'),
      ).rejects.toThrow('Could not decrypt data')
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

  // One full encryption cycle per provider, declared before everything that
  // consumes its keys -- vitest runs a suite's tasks in declaration order, and
  // getKeys() only has values once the cycle test has run. Both the
  // per-provider blocks and the cross-provider block below share these two key
  // sets: running the cycle a second time to get a second set cost two extra
  // 4096-bit RSA keygens (~1s each) and covered nothing the first pair did not.
  const nodeTest = runTests(nodeCrypto, 'NodeCryptoLib')
  const browserTest = runTests(browserCrypto, 'BrowserCryptoLib')

  describe('NodeCryptoLib', () => {
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
        testPassword,
        V2_KDF_PARAMETERS,
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
        testPassword,
        V2_KDF_PARAMETERS,
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
        testAad,
      )
      const decrypted = await browserCrypto.decryptSymmetric(
        nodeSymmetricKey,
        encrypted,
        testAad,
      )
      expect(decrypted).toEqual(testMessage)
    })

    test('Browser can encrypt with symmetric key and Node can decrypt', async () => {
      const { symmetricKey: browserSymmetricKey } = browserTest.getKeys()
      const encrypted = await browserCrypto.encryptSymmetric(
        browserSymmetricKey,
        testMessage,
        testAad,
      )
      const decrypted = await nodeCrypto.decryptSymmetric(
        browserSymmetricKey,
        encrypted,
        testAad,
      )
      expect(decrypted).toEqual(testMessage)
    })

    test('OAEP is MGF1-SHA-256 on both sides, not just SHA-256 labels', async () => {
      // node's `oaepHash: 'sha256'` sets the label digest AND MGF1 together;
      // node-forge takes them as separate options. It does default mgf1 to md
      // when mgf1 is omitted, so the hazard is not a forgotten option but an
      // EXPLICIT mismatch -- which round-trips perfectly inside forge and
      // fails only against node, i.e. only on a user's second device.
      const { publicKey: nodePublicKey, privateKey: nodePrivateKey } =
        nodeTest.getKeys()

      const publicKeyObj = forge.pki.publicKeyFromPem(nodePublicKey)
      const mismatched = btoa(
        publicKeyObj.encrypt(testMessage, 'RSA-OAEP', {
          md: forge.md.sha256.create(),
          mgf1: { md: forge.md.sha1.create() },
        }),
      )

      await expect(
        nodeCrypto.decrypt(nodePrivateKey, mismatched as never),
      ).rejects.toThrow()

      // ...while what the provider actually does round-trips both ways.
      const fromBrowser = await browserCrypto.encrypt(
        nodePublicKey,
        testMessage,
      )
      expect(await nodeCrypto.decrypt(nodePrivateKey, fromBrowser)).toBe(
        testMessage,
      )
      const fromNode = await nodeCrypto.encrypt(nodePublicKey, testMessage)
      expect(await browserCrypto.decrypt(nodePrivateKey, fromNode)).toBe(
        testMessage,
      )
    })

    test('Node and Browser createSyncKey produce the same result', async () => {
      const sharedKey = new Uint8Array([1, 2, 3, 4, 5])
      const salt = 'testSalt' as Salt

      const nodeSyncKey = await nodeCrypto.createSyncKey(sharedKey, salt)
      const browserSyncKey = await browserCrypto.createSyncKey(sharedKey, salt)

      expect(nodeSyncKey).toBe(browserSyncKey)
      expect(nodeSyncKey.length).toBeGreaterThan(0)
    })
  })
})
