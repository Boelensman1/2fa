import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'
import {
  createTwoFaLib,
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
  deviceIdentifier,
  omit,
  passphrase,
} from '../testUtils.mjs'
import { totpEntry } from '../testUtils.mjs'
import type { SaveFunctionData } from '../../src/interfaces/SaveFunction.mjs'
import type { UserId } from '../../src/interfaces/SyncTypes.mjs'

describe('PersistentStorageManager', () => {
  let twoFaLib: TwoFaLib
  let cryptoLib: CryptoLib
  let encryptedPrivateKey: EncryptedPrivateKey
  let encryptedSymmetricKey: EncryptedSymmetricKey
  let salt: Salt

  beforeAll(async () => {
    const result = await createTwoFaLibForTests()
    twoFaLib = result.twoFaLib
    cryptoLib = result.cryptoLib
    encryptedPrivateKey = result.encryptedPrivateKey
    encryptedSymmetricKey = result.encryptedSymmetricKey
    salt = result.salt
  })

  beforeEach(async () => {
    await clearEntries(twoFaLib)
  })

  it('should return a locked representation', async () => {
    const entryId = await twoFaLib.vault.addEntry(totpEntry)

    const locked = await twoFaLib.persistentStorage.getLockedRepresentation()
    expect(locked).toHaveLength(345)

    const second2faLib = new TwoFaLib(deviceIdentifier, cryptoLib)
    await second2faLib.init(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
      'userid' as UserId,
    )
    await second2faLib.persistentStorage.loadFromLockedRepresentation(locked)

    const retrieved = second2faLib.vault.getEntryMeta(entryId)
    expect(retrieved).toEqual(
      omit(
        {
          ...totpEntry,
          id: entryId,
          order: 0,
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
        'userid' as UserId,
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
        'userid' as UserId,
      ),
    ).rejects.toThrow('Invalid private key')
  })

  it('should validate correct passphrase', async () => {
    const isValid = await twoFaLib.persistentStorage.validatePassphrase(
      salt,
      passphrase,
    )
    expect(isValid).toBe(true)
  })

  it('should invalidate incorrect passphrase', async () => {
    const isValid = await twoFaLib.persistentStorage.validatePassphrase(
      salt,
      'wrongpassword!' as Passphrase,
    )
    expect(isValid).toBe(false)
  })

  it('should call save function when changes are made', async () => {
    const mockSaveFunction = vi.fn()
    const result = await createTwoFaLib(
      deviceIdentifier,
      cryptoLib,
      'testpassword' as Passphrase,
      mockSaveFunction,
    )
    const twoFaLib = result.twoFaLib
    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)

    // Add an entry
    await twoFaLib.vault.addEntry(totpEntry)

    // Check if save function was called again
    expect(mockSaveFunction).toHaveBeenCalledTimes(2)
    expect(mockSaveFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedRepresentation: expect.any(String) as string,
        encryptedPrivateKey: expect.any(String) as string,
        encryptedSymmetricKey: expect.any(String) as string,
        salt: expect.any(String) as string,
        userId: expect.any(String) as string,
        syncDevices: expect.any(String) as string,
      }),
      expect.objectContaining({
        lockedRepresentation: true,
        encryptedPrivateKey: true,
        encryptedSymmetricKey: true,
        salt: true,
        userId: true,
        syncDevices: true,
      }),
      expect.any(TwoFaLib),
    )

    // Reset mock
    mockSaveFunction.mockClear()

    // Update an entry
    const entries = twoFaLib.vault.listEntries()
    await twoFaLib.vault.updateEntry(entries[0], { name: 'Updated TOTP' })

    // Check if save function was called
    expect(mockSaveFunction).toHaveBeenCalledTimes(1)
    expect(mockSaveFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedRepresentation: expect.any(String) as string,
        encryptedPrivateKey: expect.any(String) as string,
        encryptedSymmetricKey: expect.any(String) as string,
        salt: expect.any(String) as string,
        userId: expect.any(String) as string,
        syncDevices: expect.any(String) as string,
      }),
      expect.objectContaining({
        lockedRepresentation: true,
        encryptedPrivateKey: false,
        encryptedSymmetricKey: false,
        salt: false,
        userId: false,
        syncDevices: false,
      }),
      expect.any(TwoFaLib),
    )
  }, 15000) // long running test

  it('should change passphrase', async () => {
    const oldPassphrase = 'testpassword' as Passphrase
    const newPassphrase = 'newpassword' as Passphrase
    let savedData: SaveFunctionData

    const mockSaveFunction = vi.fn((data: SaveFunctionData) => {
      savedData = data
      return Promise.resolve()
    })

    const result = await createTwoFaLib(
      deviceIdentifier,
      cryptoLib,
      oldPassphrase,
      mockSaveFunction,
    )
    const originalTwoFaLib = result.twoFaLib

    await originalTwoFaLib.persistentStorage.changePassphrase(
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
    const newTwoFaLib = new TwoFaLib(deviceIdentifier, cryptoLib)
    await newTwoFaLib.init(
      savedData.encryptedPrivateKey,
      savedData.encryptedSymmetricKey,
      savedData.salt,
      newPassphrase,
      'userid' as UserId,
    )

    // Verify that the new passphrase works
    await expect(
      newTwoFaLib.persistentStorage.validatePassphrase(
        savedData.salt,
        newPassphrase,
      ),
    ).resolves.toBe(true)

    // Verify that the old passphrase no longer works
    await expect(
      newTwoFaLib.persistentStorage.validatePassphrase(
        savedData.salt,
        oldPassphrase,
      ),
    ).resolves.toBe(false)
  }, 15000) // long running test
})
