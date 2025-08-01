import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  beforeAll,
  type Mock,
} from 'vitest'
import {
  getTwoFaLibVaultCreationUtils,
  TwoFaLib,
  type LockedRepresentationString,
  type Password,
  type Salt,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
} from '../../src/main.mjs'
import { nodeProviders } from '../../src/platformProviders/node/index.mjs'
import {
  clearEntries,
  createTwoFaLibForTests,
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
  let twoFaLib: TwoFaLib
  let persistentStorageManager: PersistentStorageManager
  let password: Password
  let salt: Salt
  let encryptedPrivateKey: EncryptedPrivateKey
  let encryptedSymmetricKey: EncryptedSymmetricKey

  beforeAll(async () => {
    const result = await createTwoFaLibForTests()
    twoFaLib = result.twoFaLib
    password = result.password
    salt = result.salt
    encryptedPrivateKey = result.encryptedPrivateKey
    encryptedSymmetricKey = result.encryptedSymmetricKey

    // eslint-disable-next-line @typescript-eslint/dot-notation
    persistentStorageManager = twoFaLib['persistentStorageManager']
  })

  beforeEach(async () => {
    await clearEntries(twoFaLib)
  })

  it('should return a locked representation', async () => {
    await twoFaLib.vault.addEntry(newTotpEntry)

    // Get the internal cryptoLib instance used by persistentStorageManager
    // @ts-expect-error: Using private property for testing
    const internalCryptoLib = persistentStorageManager.cryptoLib

    // Store original implementations
    const originalEncryptSymmetric = internalCryptoLib.encryptSymmetric

    // mockEncryptSymmetric for easier testing
    const mockEncryptSymmetric = vi
      .fn()
      .mockImplementation((_key: string, vaultState: string) => {
        return vaultState
      })
    // Override the implementation on the internal cryptoLib
    internalCryptoLib.encryptSymmetric = mockEncryptSymmetric

    // @ts-expect-error: Using private property for testing
    const mediator = persistentStorageManager.mediator
    const mockedSyncManager = {
      syncDevices: 'syncDevicesFromMock',
      serverUrl: 'serverUrlFromMock',
      getCommandSendQueue: () => 'syncCommandSendQueueFromMock',
    } as unknown as SyncManager
    mediator.registerComponent('syncManager', mockedSyncManager)

    const locked = await persistentStorageManager.getLockedRepresentation()

    expect(mockEncryptSymmetric).toHaveBeenCalledOnce()

    // should be json
    expect(locked).toMatch(/^{/)

    const parsed = JSON.parse(locked) as LockedRepresentation

    expect(parsed).toEqual({
      libVersion: TwoFaLib.version,
      storageVersion: expect.any(Number) as number,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      encryptedVaultState: expect.any(String) as string,
    })

    expect(parsed.encryptedVaultState).toMatch(/^{/)
    const parsedVaultState = JSON.parse(
      parsed.encryptedVaultState,
    ) as VaultState
    expect(parsedVaultState).toEqual({
      deviceId: twoFaLib.meta.deviceId,
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

    // Restore original implementations
    internalCryptoLib.encryptSymmetric = originalEncryptSymmetric
    mediator.unRegisterComponent('syncManager')
  })

  it('Should save when save is called', async () => {
    const mockSaveFunction = vi.fn()
    twoFaLib.storage.setSaveFunction(mockSaveFunction)
    await persistentStorageManager.save()
    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)
  })

  it('Should save when data is changed', async () => {
    const mockSaveFunction = vi.fn()
    twoFaLib.storage.setSaveFunction(mockSaveFunction)

    // Add an entry
    await twoFaLib.vault.addEntry(newTotpEntry)

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
    const entries = twoFaLib.vault.listEntries()
    await twoFaLib.vault.updateEntry(entries[0], { name: 'Updated TOTP' })

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

    // Create a new TwoFaLib instance with the saved data
    const { loadTwoFaLibFromLockedRepesentation } =
      getTwoFaLibVaultCreationUtils(nodeProviders, deviceType, ['test'])
    const newTwoFaLib = await loadTwoFaLibFromLockedRepesentation(
      savedData,
      newPassword,
    )

    // eslint-disable-next-line @typescript-eslint/dot-notation
    const newPersistentStorageManager = newTwoFaLib['persistentStorageManager']

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

    twoFaLib.storage.setSaveFunction(mockSaveFunction)

    // Trigger multiple save operations simultaneously
    const promises = [
      twoFaLib.storage.forceSave(),
      twoFaLib.storage.forceSave(),
      twoFaLib.storage.forceSave(),
    ]

    await Promise.all(promises)

    // Verify that save was called for each operation
    expect(mockSaveFunction).toHaveBeenCalledTimes(3)
    expect(saveCallCount).toBe(3)

    // Verify that saves were queued/serialized, not run concurrently
    expect(maxConcurrentSaves).toBe(1)
  }, 15000) // long running test
})
