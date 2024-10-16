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
  ChangedEventData,
  CryptoLib,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  Salt,
  TwoFaLib,
} from '../../src/main.mjs'
import {
  clearEntries,
  createTwoFaLibForTests,
  deviceId,
  deviceType,
  omit,
  passphrase,
} from '../testUtils.mjs'
import { newTotpEntry } from '../testUtils.mjs'
import type { DeviceId } from '../../src/interfaces/SyncTypes.mjs'
import { TwoFaLibEvent } from '../../src/TwoFaLibEvent.mjs'
import type PersistentStorageManager from '../../src/subclasses/PersistentStorageManager.mjs'

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
  let twoFaLib: TwoFaLib
  let cryptoLib: CryptoLib
  let encryptedPrivateKey: EncryptedPrivateKey
  let encryptedSymmetricKey: EncryptedSymmetricKey
  let salt: Salt
  let persistentStorageManager: PersistentStorageManager

  beforeAll(async () => {
    const result = await createTwoFaLibForTests()
    twoFaLib = result.twoFaLib
    cryptoLib = result.cryptoLib
    encryptedPrivateKey = result.encryptedPrivateKey
    encryptedSymmetricKey = result.encryptedSymmetricKey
    salt = result.salt

    // eslint-disable-next-line @typescript-eslint/dot-notation
    persistentStorageManager = twoFaLib['persistentStorage']
  })

  beforeEach(async () => {
    await clearEntries(twoFaLib)
  })

  it('should return a locked representation', async () => {
    const entryId = await twoFaLib.vault.addEntry(newTotpEntry)

    const locked = await persistentStorageManager.getLockedRepresentation()
    expect(locked).toHaveLength(325)

    const second2faLib = new TwoFaLib(deviceType, cryptoLib, ['test'])
    await second2faLib.init(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
      'deviceid' as DeviceId,
    )
    // eslint-disable-next-line @typescript-eslint/dot-notation
    await second2faLib['persistentStorage'].loadFromLockedRepresentation(locked)

    const retrieved = second2faLib.vault.getEntryMeta(entryId)
    expect(retrieved).toEqual(
      omit(
        {
          ...newTotpEntry,
          id: entryId,
          addedAt: expect.any(Number) as number,
          updatedAt: null,
        },
        'payload',
      ),
    )
  }, 15000) // long running test

  it('should throw an error on invalid passphrase', async () => {
    await expect(
      twoFaLib.init(
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        'not-the-passphrase' as Passphrase,
        deviceId,
      ),
    ).rejects.toThrow('Invalid passphrase')
  })

  it('should throw an error on invalid private key', async () => {
    await expect(
      twoFaLib.init(
        'not-a-key' as EncryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        'testpassword' as Passphrase,
        deviceId,
      ),
    ).rejects.toThrow('Invalid private key')
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

  it('should emit changed event when data is changed', async () => {
    const mockChangedFunction = vi.fn()
    twoFaLib.addEventListener(TwoFaLibEvent.Changed, mockChangedFunction)

    await twoFaLib.vault.addEntry(newTotpEntry)

    expect(mockChangedFunction).toHaveBeenCalledTimes(1)
  })

  it('Should set everything to changed when setChanged is called without arguments and emit the correct event', async () => {
    const mockSaveFunction = vi.fn()
    twoFaLib.addEventListener(TwoFaLibEvent.Changed, mockSaveFunction)
    await persistentStorageManager.setChanged()
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
      data: expect.objectContaining({
        lockedRepresentation: expect.any(String) as string,
        encryptedPrivateKey: expect.any(String) as string,
        encryptedSymmetricKey: expect.any(String) as string,
        salt: expect.any(String) as string,
        deviceId: expect.any(String) as string,
        syncDevices: expect.any(String) as string,
      }) as unknown,
      changed: expect.objectContaining({
        lockedRepresentation: true,
        encryptedPrivateKey: true,
        encryptedSymmetricKey: true,
        salt: true,
        deviceId: true,
        syncDevices: true,
      }) as unknown,
    })

    // Reset mock
    mockSaveFunction.mockClear()

    // Update an entry
    const entries = twoFaLib.vault.listEntries()
    await twoFaLib.vault.updateEntry(entries[0], { name: 'Updated TOTP' })

    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)

    expect(getNthCallTypeAndDetail(mockSaveFunction, 0).detail).toEqual({
      data: expect.objectContaining({
        lockedRepresentation: expect.any(String) as string,
        encryptedPrivateKey: expect.any(String) as string,
        encryptedSymmetricKey: expect.any(String) as string,
        salt: expect.any(String) as string,
        deviceId: expect.any(String) as string,
        syncDevices: expect.any(String) as string,
      }) as unknown,
      changed: expect.objectContaining({
        lockedRepresentation: true,
        encryptedPrivateKey: false,
        encryptedSymmetricKey: false,
        salt: false,
        deviceId: false,
        syncDevices: false,
      }) as unknown,
    })
  }, 15000) // long running test

  it('should change passphrase', async () => {
    const oldPassphrase = passphrase
    const newPassphrase = '8ySml!DK6QxJP6e6l$Cf' as Passphrase
    let savedData: ChangedEventData

    const mockSaveFunction = vi.fn((data: ChangedEventData) => {
      savedData = data
    })

    const originalTwoFaLib = twoFaLib
    originalTwoFaLib.addEventListener(TwoFaLibEvent.Changed, (evt) => {
      mockSaveFunction(evt.detail.data)
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
    const newTwoFaLib = new TwoFaLib(deviceType, cryptoLib, ['test'])
    await newTwoFaLib.init(
      savedData.encryptedPrivateKey,
      savedData.encryptedSymmetricKey,
      savedData.salt,
      newPassphrase,
      deviceId,
    )
    // eslint-disable-next-line @typescript-eslint/dot-notation
    const newPersistentStorageManager = newTwoFaLib['persistentStorage']

    // Verify that the new passphrase works
    await expect(
      newPersistentStorageManager.validatePassphrase(
        savedData.salt,
        newPassphrase,
      ),
    ).resolves.toBe(true)

    // Verify that the old passphrase no longer works
    await expect(
      newPersistentStorageManager.validatePassphrase(
        savedData.salt,
        oldPassphrase,
      ),
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
})
