import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  beforeAll,
  type Mock,
} from 'vitest'
import { base64ToUint8Array } from 'uint8array-extras'
import {
  getFavaLibVaultCreationUtils,
  FavaLib,
  type LockedRepresentationString,
  type Password,
  type Salt,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  STORAGE_VERSION,
  type KdfParameters,
  type SymmetricKey,
} from '../../src/main.mjs'
import { buildVaultAad } from '../../src/utils/canonical.mjs'
import { nodeProviders } from '../../src/platformProviders/node/index.mjs'
import {
  clearEntries,
  createFavaLibForTests,
  deviceType,
} from '../testUtils.mjs'
import { newTotpEntry } from '../testUtils.mjs'
import type PersistentStorageManager from '../../src/subclasses/PersistentStorageManager.mjs'
import type {
  LockedRepresentation,
  VaultState,
} from '../../src/interfaces/Vault.mjs'
import type SyncManager from '../../src/subclasses/SyncManager.mjs'

const getNthMockCallFirstArg = (mockFn: Mock, n: number) => {
  return mockFn.mock.calls[n][0] as string
}

describe('PersistentStorageManager', () => {
  let favaLib: FavaLib
  let persistentStorageManager: PersistentStorageManager
  let password: Password
  let salt: Salt
  let encryptedPrivateKey: EncryptedPrivateKey
  let encryptedSymmetricKey: EncryptedSymmetricKey
  let symmetricKey: SymmetricKey
  let kdf: KdfParameters

  beforeAll(async () => {
    const result = await createFavaLibForTests()
    favaLib = result.favaLib
    password = result.password
    salt = result.salt
    encryptedPrivateKey = result.encryptedPrivateKey
    encryptedSymmetricKey = result.encryptedSymmetricKey
    symmetricKey = result.symmetricKey
    kdf = result.kdf

    // eslint-disable-next-line @typescript-eslint/dot-notation
    persistentStorageManager = favaLib['persistentStorageManager']
  })

  beforeEach(async () => {
    await clearEntries(favaLib)
  })

  it('should return a locked representation', async () => {
    await favaLib.vault.addEntry(newTotpEntry)

    // Get the internal cryptoLib instance used by persistentStorageManager
    // @ts-expect-error: Using private property for testing
    const internalCryptoLib = persistentStorageManager.cryptoLib

    // A spy, not a stub: vitest's spyOn calls through, so everything below is
    // asserted against the real ciphertext. This used to be mocked to the
    // identity function, which left the stored encoding asserted nowhere --
    // see key-hierarchy-review/06-crypto-test-coverage.md.
    const encryptSymmetricSpy = vi.spyOn(internalCryptoLib, 'encryptSymmetric')

    // @ts-expect-error: Using private property for testing
    const mediator = persistentStorageManager.mediator
    const mockedSyncManager = {
      syncDevices: 'syncDevicesFromMock',
      serverUrl: 'serverUrlFromMock',
      getCommandSendQueue: () => 'syncCommandSendQueueFromMock',
    } as unknown as SyncManager
    mediator.registerComponent('syncManager', mockedSyncManager)

    const locked = await persistentStorageManager.getLockedRepresentation()

    expect(encryptSymmetricSpy).toHaveBeenCalledOnce()

    // should be json
    expect(locked).toMatch(/^{/)

    const parsed = JSON.parse(locked) as LockedRepresentation

    expect(parsed).toEqual({
      libVersion: FavaLib.version,
      storageVersion: STORAGE_VERSION,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      kdf,
      envelopeMac: expect.any(String) as string,
      encryptedVaultState: expect.any(String) as string,
    })

    // The stored envelope is "v2" + ":" + base64(nonce) + ":" +
    // base64(ciphertext || tag): a 12-byte GCM nonce, and a payload that is
    // the plaintext length plus the 16-byte tag. GCM is a stream cipher, so
    // unlike the v1 CBC envelope the ciphertext is NOT a multiple of 16.
    const envelope = parsed.encryptedVaultState.split(':')
    expect(envelope).toHaveLength(3)
    const [prefix, nonce, cipherText] = envelope
    expect(prefix).toBe('v2')
    expect(base64ToUint8Array(nonce)).toHaveLength(12)
    const cipherBytes = base64ToUint8Array(cipherText)
    expect(cipherBytes.length).toBeGreaterThan(16)

    // And it decrypts, with the vault's own symmetric key AND the at-rest
    // AAD, back to the state. Rebuilding the AAD here rather than reading it
    // from the library is the point: if the two ever disagree, this fails.
    const cryptoLib = new nodeProviders.CryptoLib()
    const aad = buildVaultAad(
      STORAGE_VERSION,
      salt,
      kdf,
      await cryptoLib.sha256(encryptedPrivateKey),
    )
    expect(cipherBytes.length).toBe(
      new TextEncoder().encode(
        await cryptoLib.decryptSymmetric(
          symmetricKey,
          parsed.encryptedVaultState,
          aad,
        ),
      ).length + 16,
    )
    const vaultStateString = await cryptoLib.decryptSymmetric(
      symmetricKey,
      parsed.encryptedVaultState,
      aad,
    )
    expect(vaultStateString).toMatch(/^{/)
    const parsedVaultState = JSON.parse(vaultStateString) as VaultState
    expect(parsedVaultState).toEqual({
      deviceId: favaLib.meta.deviceId,
      sync: {
        devices: 'syncDevicesFromMock',
        serverUrl: 'serverUrlFromMock',
        commandSendQueue: 'syncCommandSendQueueFromMock',
      },
      vault: [
        {
          id: expect.any(String) as string,
          name: 'Test TOTP',
          issuer: 'Test Issuer',
          type: 'TOTP',
          matchers: [],
          url: null,
          inputSelector: null,
          addedAt: expect.any(Number) as number,
          updatedAt: null,
          payload: {
            secret: 'TESTSECRET',
            period: 30,
            algorithm: 'SHA-1',
            digits: 6,
          },
        },
      ],
    })

    encryptSymmetricSpy.mockRestore()
    mediator.unRegisterComponent('syncManager')
  })

  it('Should save when save is called', async () => {
    const mockSaveFunction = vi.fn()
    favaLib.storage.setSaveFunction(mockSaveFunction)
    await persistentStorageManager.save()
    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)
  })

  it('Should save when data is changed', async () => {
    const mockSaveFunction = vi.fn()
    favaLib.storage.setSaveFunction(mockSaveFunction)

    // Add an entry
    await favaLib.vault.addEntry(newTotpEntry)

    // Check if save function was called again
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)

    // Check if the save function was called with the correct argument
    const firstCall = getNthMockCallFirstArg(mockSaveFunction, 0)
    expect(firstCall).toEqual(expect.any(String) as string)
    expect(() => {
      JSON.parse(firstCall)
    }).not.toThrow()

    // Reset mock
    mockSaveFunction.mockClear()

    // Update an entry
    const entries = favaLib.vault.listEntries()
    await favaLib.vault.updateEntry(entries[0], { name: 'Updated TOTP' })

    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)

    const secondCall = getNthMockCallFirstArg(mockSaveFunction, 0)
    expect(secondCall).toEqual(expect.any(String))
    expect(() => {
      JSON.parse(secondCall)
    }).not.toThrow()

    expect(firstCall).not.toEqual(secondCall)
  }, 15000) // long running test

  it('should change password', async () => {
    const oldPassword = password
    const newPassword = '8ySml!DK6QxJP6e6l$Cf' as Password
    let savedData: LockedRepresentationString

    const mockSaveFunction = vi.fn((data: LockedRepresentationString) => {
      savedData = data
    })

    persistentStorageManager.setSaveFunction(mockSaveFunction)

    await persistentStorageManager.changePassword(oldPassword, newPassword)

    // Verify that the save function was called
    expect(mockSaveFunction).toHaveBeenCalled()

    if (!savedData!) {
      // eslint-disable-next-line no-restricted-globals
      throw new Error('No saved data')
    }

    // Create a new FavaLib instance with the saved data
    const { loadFavaLibFromLockedRepesentation } = getFavaLibVaultCreationUtils(
      nodeProviders,
      deviceType,
      ['test'],
    )
    const newFavaLib = await loadFavaLibFromLockedRepesentation(
      savedData,
      newPassword,
    )

    // eslint-disable-next-line @typescript-eslint/dot-notation
    const newPersistentStorageManager = newFavaLib['persistentStorageManager']

    // Verify that the new password works
    await expect(
      newPersistentStorageManager.validatePassword(salt, newPassword),
    ).resolves.toBe(true)

    // Verify that the old password no longer works
    await expect(
      newPersistentStorageManager.validatePassword(salt, oldPassword),
    ).resolves.toBe(false)

    // change back the password for the next tests
    await persistentStorageManager.changePassword(newPassword, oldPassword)
  }, 15000) // long running test

  it('should throw an error when changing to a weak password', async () => {
    const oldPassword = password
    const weakPassword = 'test123' as Password

    await expect(
      persistentStorageManager.changePassword(oldPassword, weakPassword),
    ).rejects.toThrow('Password is too weak')

    // Verify that the old password still works
    const isValid = await persistentStorageManager.validatePassword(
      salt,
      oldPassword,
    )
    expect(isValid).toBe(true)
  })

  it('should validate correct password', async () => {
    const isValid = await persistentStorageManager.validatePassword(
      salt,
      password,
    )
    expect(isValid).toBe(true)
  })

  it('should invalidate incorrect password', async () => {
    const isValid = await persistentStorageManager.validatePassword(
      salt,
      'wrongpassword!' as Password,
    )
    expect(isValid).toBe(false)
  })

  it('should not allow two save functions to run concurrently', async () => {
    let saveCallCount = 0
    let activeSaveCalls = 0
    let maxConcurrentSaves = 0

    const mockSaveFunction = vi.fn(async (data: LockedRepresentationString) => {
      saveCallCount++
      activeSaveCalls++
      maxConcurrentSaves = Math.max(maxConcurrentSaves, activeSaveCalls)

      // Simulate some async work
      await new Promise((resolve) => setTimeout(resolve, 100))

      activeSaveCalls--

      expect(data).toBeTypeOf('string')
    })

    favaLib.storage.setSaveFunction(mockSaveFunction)

    // Trigger multiple save operations simultaneously
    const promises = [
      favaLib.storage.forceSave(),
      favaLib.storage.forceSave(),
      favaLib.storage.forceSave(),
    ]

    await Promise.all(promises)

    // Verify that save was called for each operation
    expect(mockSaveFunction).toHaveBeenCalledTimes(3)
    expect(saveCallCount).toBe(3)

    // Verify that saves were queued/serialized, not run concurrently
    expect(maxConcurrentSaves).toBe(1)
  }, 15000) // long running test
})
