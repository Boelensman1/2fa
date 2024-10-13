import { describe, it, expect, beforeEach, beforeAll, vi, Mock } from 'vitest'

import {
  CryptoLib,
  DeviceType,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  TwoFaLib,
  TwoFaLibEvent,
  Salt,
  Passphrase,
} from '../src/main.mjs'

import {
  clearEntries,
  createTwoFaLibForTests,
  deviceType,
  deviceId,
} from './testUtils.mjs'

describe('2falib', () => {
  let cryptoLib: CryptoLib
  let twoFaLib: TwoFaLib
  let mockPersistentStorageManager: { setChanged: Mock; init: Mock }
  let encryptedPrivateKey: EncryptedPrivateKey
  let encryptedSymmetricKey: EncryptedSymmetricKey
  let salt: Salt
  let passphrase: Passphrase

  beforeAll(async () => {
    const result = await createTwoFaLibForTests()
    twoFaLib = result.twoFaLib
    cryptoLib = result.cryptoLib
    encryptedPrivateKey = result.encryptedPrivateKey
    encryptedSymmetricKey = result.encryptedSymmetricKey
    salt = result.salt
    passphrase = result.passphrase
  })

  beforeEach(async () => {
    await clearEntries(twoFaLib)
    mockPersistentStorageManager = {
      setChanged: vi.fn(),
      init: vi.fn().mockResolvedValue({ publicKey: null, privateKey: null }),
    }
    // @ts-expect-error: Overriding private property for testing
    twoFaLib.mediator.components.persistentStorageManager =
      mockPersistentStorageManager
  })

  describe('TwoFaLib constructor', () => {
    it('should throw an error if device identifier is not provided', () => {
      expect(() => new TwoFaLib('' as DeviceType, cryptoLib, ['test'])).toThrow(
        'Device identifier is required',
      )
    })

    it('should throw an error if device identifier is too long', () => {
      const longDeviceIdentifier = 'a'.repeat(257)
      expect(
        () =>
          new TwoFaLib(longDeviceIdentifier as DeviceType, cryptoLib, ['test']),
      ).toThrow('Device identifier is too long, max 256 characters')
    })

    it('should throw an error if CryptoLib is not provided', () => {
      // @ts-expect-error null is not a valid argument for TwoFaLib
      expect(() => new TwoFaLib(deviceType, null)).toThrow(
        'CryptoLib is required',
      )
    })

    it('should throw an error if passphrase extra dictionary is not provided', () => {
      // @ts-expect-error empty array is not a valid argument
      expect(() => new TwoFaLib(deviceType, cryptoLib, [])).toThrow(
        'Passphrase extra dictionary is required',
      )
    })

    it('should create a TwoFaLib instance with valid parameters', () => {
      const twoFaLib = new TwoFaLib(deviceType, cryptoLib, ['test'])
      expect(twoFaLib).toBeInstanceOf(TwoFaLib)
      expect(twoFaLib.deviceType).toBe(deviceType)
    })
  })

  it('should save the current state when forceSave is called', async () => {
    await twoFaLib.forceSave()
    expect(mockPersistentStorageManager.setChanged).toHaveBeenCalledWith()
  })

  it('should emit ready event after loading', async () => {
    const mockReadyFunction = vi.fn()
    twoFaLib.addEventListener(TwoFaLibEvent.Ready, mockReadyFunction)
    await twoFaLib.init(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
      deviceId,
    )

    // Ceck if the ready event was emitted
    expect(mockReadyFunction).toHaveBeenCalledTimes(1)

    // Clean up the event listener
    twoFaLib.removeEventListener(TwoFaLibEvent.Ready, mockReadyFunction)
  })
})
