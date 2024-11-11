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
  type Passphrase,
  type CryptoLib,
  type Salt,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
} from '../../src/main.mjs'
import {
  clearEntries,
  createTwoFaLibForTests,
  deviceType,
} from '../testUtils.mjs'
import { newTotpEntry } from '../testUtils.mjs'
import { TwoFaLibEvent } from '../../src/TwoFaLibEvent.mjs'
import type PersistentStorageManager from '../../src/subclasses/PersistentStorageManager.mjs'
import type {
  LockedRepresentation,
  VaultState,
} from '../../src/interfaces/Vault.mjs'
import type SyncManager from '../../src/subclasses/SyncManager.mjs'

const getNthCallTypeAndDetail = (mockFn: Mock, n: number) => {
  const call = mockFn.mock.calls[n][0] as {
    type: unknown
    detail: unknown
  }
  return {
    type: call.type as TwoFaLibEvent,
    detail: call.detail,
  }
}

describe('PersistentStorageManager', () => {
  let cryptoLib: CryptoLib
  let twoFaLib: TwoFaLib
  let persistentStorageManager: PersistentStorageManager
  let passphrase: Passphrase
  let salt: Salt
  let encryptedPrivateKey: EncryptedPrivateKey
  let encryptedSymmetricKey: EncryptedSymmetricKey

  beforeAll(async () => {
    const result = await createTwoFaLibForTests()
    cryptoLib = result.cryptoLib
    twoFaLib = result.twoFaLib
    passphrase = result.passphrase
    salt = result.salt
    encryptedPrivateKey = result.encryptedPrivateKey
    encryptedSymmetricKey = result.encryptedSymmetricKey

    // eslint-disable-next-line @typescript-eslint/dot-notation
    persistentStorageManager = twoFaLib['persistentStorage']
  })

  beforeEach(async () => {
    await clearEntries(twoFaLib)
  })

  it('should return a locked representation', async () => {
    await twoFaLib.vault.addEntry(newTotpEntry)

    // Store original implementations
    const originalEncryptSymmetric = cryptoLib.encryptSymmetric

    // mockEncryptSymmetric for easier testing
    const mockEncryptSymmetric = vi
      .fn()
      .mockImplementation((_key: string, vaultState: string) => {
        return vaultState
      })
    // Override the implementation
    cryptoLib.encryptSymmetric = mockEncryptSymmetric

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
      deviceId: twoFaLib.deviceId,
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
    cryptoLib.encryptSymmetric = originalEncryptSymmetric
    mediator.unRegisterComponent('syncManager')
  })

  it('should emit changed event when data is changed', async () => {
    const mockChangedFunction = vi.fn()
    twoFaLib.addEventListener(TwoFaLibEvent.Changed, mockChangedFunction)

    await twoFaLib.vault.addEntry(newTotpEntry)

    expect(mockChangedFunction).toHaveBeenCalledTimes(1)
  })

  it('Should emit save event when save is called', async () => {
    const mockSaveFunction = vi.fn()
    twoFaLib.addEventListener(TwoFaLibEvent.Changed, mockSaveFunction)
    await persistentStorageManager.save()
    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)

    // Add an entry
    await twoFaLib.vault.addEntry(newTotpEntry)

    // Check if save function was called again
    expect(mockSaveFunction).toHaveBeenCalledTimes(2)

    // Check if the save function was called with the correct arguments
    const firstCall = getNthCallTypeAndDetail(mockSaveFunction, 0)
    expect(firstCall.type).toEqual('changed')
    expect(firstCall.detail).toEqual({
      newLockedRepresentationString: expect.any(String) as string,
    })
    // TODO: check if this newLockedRepresentationString is valid

    // Reset mock
    mockSaveFunction.mockClear()

    // Update an entry
    const entries = twoFaLib.vault.listEntries()
    await twoFaLib.vault.updateEntry(entries[0], { name: 'Updated TOTP' })

    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)

    expect(getNthCallTypeAndDetail(mockSaveFunction, 0).detail).toEqual({
      newLockedRepresentationString: expect.any(String) as string,
    })
    // TODO: check if this newLockedRepresentationString is valid
  }, 15000) // long running test

  it('should change passphrase', async () => {
    const oldPassphrase = passphrase
    const newPassphrase = '8ySml!DK6QxJP6e6l$Cf' as Passphrase
    let savedData: LockedRepresentationString

    const mockSaveFunction = vi.fn((data: LockedRepresentationString) => {
      savedData = data
    })

    const originalTwoFaLib = twoFaLib
    originalTwoFaLib.addEventListener(TwoFaLibEvent.Changed, (evt) => {
      mockSaveFunction(evt.detail.newLockedRepresentationString)
    })

    await persistentStorageManager.changePassphrase(
      oldPassphrase,
      newPassphrase,
    )

    // Verify that the save function was called
    expect(mockSaveFunction).toHaveBeenCalled()

    if (!savedData!) {
      // eslint-disable-next-line no-restricted-globals
      throw new Error('No saved data')
    }

    // Create a new TwoFaLib instance with the saved data
    const { loadTwoFaLibFromLockedRepesentation } =
      getTwoFaLibVaultCreationUtils(cryptoLib, deviceType, ['test'])
    const newTwoFaLib = await loadTwoFaLibFromLockedRepesentation(
      savedData,
      newPassphrase,
    )

    // eslint-disable-next-line @typescript-eslint/dot-notation
    const newPersistentStorageManager = newTwoFaLib['persistentStorage']

    // Verify that the new passphrase works
    await expect(
      newPersistentStorageManager.validatePassphrase(salt, newPassphrase),
    ).resolves.toBe(true)

    // Verify that the old passphrase no longer works
    await expect(
      newPersistentStorageManager.validatePassphrase(salt, oldPassphrase),
    ).resolves.toBe(false)

    // change back the passphrase for the next tests
    await persistentStorageManager.changePassphrase(
      newPassphrase,
      oldPassphrase,
    )
  }, 15000) // long running test

  it('should throw an error when changing to a weak passphrase', async () => {
    const oldPassphrase = passphrase
    const weakPassphrase = 'test123' as Passphrase

    await expect(
      persistentStorageManager.changePassphrase(oldPassphrase, weakPassphrase),
    ).rejects.toThrow('Passphrase is too weak')

    // Verify that the old passphrase still works
    const isValid = await persistentStorageManager.validatePassphrase(
      salt,
      oldPassphrase,
    )
    expect(isValid).toBe(true)
  })

  it('should validate correct passphrase', async () => {
    const isValid = await persistentStorageManager.validatePassphrase(
      salt,
      passphrase,
    )
    expect(isValid).toBe(true)
  })

  it('should invalidate incorrect passphrase', async () => {
    const isValid = await persistentStorageManager.validatePassphrase(
      salt,
      'wrongpassword!' as Passphrase,
    )
    expect(isValid).toBe(false)
  })
})
