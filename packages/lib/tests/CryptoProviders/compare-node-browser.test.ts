import { describe, expect, test } from 'vitest'
import crypto from 'node:crypto'
import {
  CryptoLib,
  DeviceId,
  EncryptedSecretKeys,
  EncryptedSymmetricKey,
  PublicKey,
  PrivateKey,
  SigningPublicKey,
  SigningSecretKey,
  SymmetricKey,
  Password,
  Salt,
  V2_KDF_PARAMETERS,
} from '../../src/main.mjs'

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
    let encryptedSecretKeys: EncryptedSecretKeys
    let encryptedSymmetricKey: EncryptedSymmetricKey
    let publicKey: PublicKey
    let privateKey: PrivateKey
    let signingPublicKey: SigningPublicKey
    let signingSecretKey: SigningSecretKey
    let symmetricKey: SymmetricKey
    let salt: Salt

    test(`${name}: full encryption cycle`, async () => {
      // Create keys
      const keyResult = await crypto.createKeys(testPassword)
      encryptedSecretKeys = keyResult.encryptedSecretKeys
      encryptedSymmetricKey = keyResult.encryptedSymmetricKey
      publicKey = keyResult.publicKey
      signingPublicKey = keyResult.signingPublicKey
      salt = keyResult.salt
      expect(encryptedSecretKeys).toBeTruthy()
      expect(encryptedSymmetricKey).toBeTruthy()
      expect(publicKey).toBeTruthy()
      expect(signingPublicKey).toBeTruthy()
      expect(publicKey).not.toEqual(signingPublicKey)
      expect(salt).toBeTruthy()

      // Decrypt keys
      const decryptResult = await crypto.decryptKeys(
        encryptedSecretKeys,
        encryptedSymmetricKey,
        salt,
        testPassword,
        V2_KDF_PARAMETERS,
      )
      privateKey = decryptResult.privateKey
      signingSecretKey = decryptResult.signingSecretKey
      symmetricKey = decryptResult.symmetricKey
      expect(privateKey).toBeTruthy()
      expect(signingSecretKey).toBeTruthy()
      expect(symmetricKey).toBeTruthy()
      // Both public keys are DERIVED from the secret keys rather than stored,
      // so this is what pins that the derivation agrees with what createKeys
      // handed out.
      expect(decryptResult.publicKey).toEqual(publicKey)
      expect(decryptResult.signingPublicKey).toEqual(signingPublicKey)

      // Re-encrypt keys
      const reEncrypted = await crypto.encryptKeys(
        { privateKey, signingSecretKey },
        symmetricKey,
        salt,
        testPassword,
        V2_KDF_PARAMETERS,
      )
      expect(reEncrypted.encryptedSecretKeys).toBeTruthy()
      expect(reEncrypted.encryptedSymmetricKey).toBeTruthy()
      expect(reEncrypted.encryptedSecretKeys).not.toContain(privateKey)
      expect(reEncrypted.encryptedSecretKeys).not.toContain(signingSecretKey)
      expect(reEncrypted.encryptedSymmetricKey).not.toContain(symmetricKey)

      // A signature made by this provider verifies in it.
      const signature = await crypto.sign(signingSecretKey, testMessage)
      expect(
        await crypto.verify(signingPublicKey, testMessage, signature),
      ).toBe(true)
      expect(
        await crypto.verify(signingPublicKey, testMessage + '!', signature),
      ).toBe(false)

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
        encryptedSecretKeys,
        encryptedSymmetricKey,
        publicKey,
        privateKey,
        signingPublicKey,
        signingSecretKey,
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
        encryptedSecretKeys,
        encryptedSymmetricKey,
        publicKey,
        privateKey,
        symmetricKey,
      } = nodeTest.getKeys()
      expect(encryptedSecretKeys).toBeTruthy()
      expect(encryptedSymmetricKey).toBeTruthy()
      expect(publicKey).toBeTruthy()
      expect(privateKey).toBeTruthy()
      expect(symmetricKey).toBeTruthy()
    })
  })

  describe('BrowserCryptoLib', () => {
    test('Keys are properly set after test', () => {
      const {
        encryptedSecretKeys,
        encryptedSymmetricKey,
        publicKey,
        privateKey,
        symmetricKey,
      } = browserTest.getKeys()
      expect(encryptedSecretKeys).toBeTruthy()
      expect(encryptedSymmetricKey).toBeTruthy()
      expect(publicKey).toBeTruthy()
      expect(privateKey).toBeTruthy()
      expect(symmetricKey).toBeTruthy()
    })
  })

  describe('Cross-provider compatibility', () => {
    test('Node can decrypt Browser-encrypted keys', async () => {
      const {
        encryptedSecretKeys: browserEncryptedSecretKeys,
        encryptedSymmetricKey: browserEncryptedSymmetricKey,
        publicKey: browserPublicKey,
        salt: browserSalt,
      } = browserTest.getKeys()
      const result = await nodeCrypto.decryptKeys(
        browserEncryptedSecretKeys,
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
        encryptedSecretKeys: nodeEncryptedSecretKeys,
        encryptedSymmetricKey: nodeEncryptedSymmetricKey,
        publicKey: nodePublicKey,
        salt: nodeSalt,
      } = nodeTest.getKeys()
      const result = await browserCrypto.decryptKeys(
        nodeEncryptedSecretKeys,
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

    test('a seal names its recipient, so another key cannot open it', async () => {
      // The ephemeral public key and the RECIPIENT's public key both go into
      // the HKDF info, and the recipient recomputes the second one from its own
      // secret key rather than reading it off the message. This is what the RSA
      // layer's OAEP options used to be the hazard in: two providers agreeing
      // with themselves and not with each other. There are no options to
      // mismatch now, so what is worth pinning is the binding itself.
      const { publicKey: nodePublicKey } = nodeTest.getKeys()
      const { privateKey: browserPrivateKey } = browserTest.getKeys()

      const sealed = await browserCrypto.encrypt(nodePublicKey, testMessage)

      await expect(
        nodeCrypto.decrypt(browserPrivateKey, sealed),
      ).rejects.toThrow('Could not decrypt data')
      await expect(
        browserCrypto.decrypt(browserPrivateKey, sealed),
      ).rejects.toThrow('Could not decrypt data')
    })

    test('signatures verify across providers', async () => {
      const { signingSecretKey: nodeSigningSecretKey } = nodeTest.getKeys()
      const { signingPublicKey: browserSigningPublicKey, signingSecretKey } =
        browserTest.getKeys()

      // A signature is the one thing in the system that has to mean the same to
      // a device that did not produce it, so both directions are pinned.
      const fromNode = await nodeCrypto.sign(nodeSigningSecretKey, testMessage)
      const fromBrowser = await browserCrypto.sign(
        signingSecretKey,
        testMessage,
      )
      expect(fromNode).not.toEqual(fromBrowser)

      expect(
        await browserCrypto.verify(
          nodeTest.getKeys().signingPublicKey,
          testMessage,
          fromNode,
        ),
      ).toBe(true)
      expect(
        await nodeCrypto.verify(
          browserSigningPublicKey,
          testMessage,
          fromBrowser,
        ),
      ).toBe(true)

      // The wrong signer, a changed message and a malformed signature all
      // resolve false rather than throwing: these run on data off the network.
      expect(
        await nodeCrypto.verify(
          nodeTest.getKeys().signingPublicKey,
          testMessage,
          fromBrowser,
        ),
      ).toBe(false)
      expect(
        await nodeCrypto.verify(
          browserSigningPublicKey,
          testMessage + ' ',
          fromBrowser,
        ),
      ).toBe(false)
      expect(
        await nodeCrypto.verify(
          browserSigningPublicKey,
          testMessage,
          'not a signature' as never,
        ),
      ).toBe(false)
    })

    test('Node and Browser createSyncKey produce the same result', async () => {
      const sharedKey = new Uint8Array([1, 2, 3, 4, 5])
      const responderDeviceId = 'testDeviceId' as DeviceId

      const nodeSyncKey = await nodeCrypto.createSyncKey(
        sharedKey,
        responderDeviceId,
      )
      const browserSyncKey = await browserCrypto.createSyncKey(
        sharedKey,
        responderDeviceId,
      )

      expect(nodeSyncKey).toBe(browserSyncKey)
      expect(nodeSyncKey.length).toBeGreaterThan(0)
    })
  })
})
