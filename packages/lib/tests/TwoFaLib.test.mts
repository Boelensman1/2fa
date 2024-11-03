import { describe, it, expect, beforeEach, beforeAll, vi, Mock } from 'vitest'

import {
  CryptoLib,
  DeviceType,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  TwoFaLib,
  Salt,
  PrivateKey,
  SymmetricKey,
  PublicKey,
  TwoFaLibEvent,
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
  let mockPersistentStorageManager: { save: Mock; init: Mock }
  let privateKey: PrivateKey
  let symmetricKey: SymmetricKey
  let publicKey: PublicKey
  let encryptedPrivateKey: EncryptedPrivateKey
  let encryptedSymmetricKey: EncryptedSymmetricKey
  let salt: Salt

  beforeAll(async () => {
    const result = await createTwoFaLibForTests()
    twoFaLib = result.twoFaLib
    cryptoLib = result.cryptoLib
    encryptedPrivateKey = result.encryptedPrivateKey
    encryptedSymmetricKey = result.encryptedSymmetricKey
    privateKey = result.privateKey
    symmetricKey = result.symmetricKey
    publicKey = result.publicKey
    salt = result.salt
  })

  beforeEach(async () => {
    await clearEntries(twoFaLib)
    mockPersistentStorageManager = {
      save: vi.fn(),
      init: vi.fn().mockResolvedValue({ publicKey: null, privateKey: null }),
    }
    // @ts-expect-error: Overriding private property for testing
    twoFaLib.mediator.components.persistentStorageManager =
      mockPersistentStorageManager
  })

  describe('TwoFaLib constructor', () => {
    it('should throw an error if device type is not provided', () => {
      expect(
        () =>
          new TwoFaLib(
            '' as DeviceType,
            cryptoLib,
            ['test'],
            privateKey,
            symmetricKey,
            encryptedPrivateKey,
            encryptedSymmetricKey,
            salt,
            publicKey,
            deviceId,
            [],
          ),
      ).toThrow('Device type is required')
    })

    it('should throw an error if device type is too long', () => {
      const longDeviceIdentifier = 'a'.repeat(257)
      expect(
        () =>
          new TwoFaLib(
            longDeviceIdentifier as DeviceType,
            cryptoLib,
            ['test'],
            privateKey,
            symmetricKey,
            encryptedPrivateKey,
            encryptedSymmetricKey,
            salt,
            publicKey,
            deviceId,
            [],
          ),
      ).toThrow('Device type is too long, max 256 characters')
    })

    it('should throw an error if CryptoLib is not provided', () => {
      expect(
        () =>
          new TwoFaLib(
            deviceType,
            // @ts-expect-error null is not a valid argument for TwoFaLib
            null,
            ['test'],
            privateKey,
            symmetricKey,
            encryptedPrivateKey,
            encryptedSymmetricKey,
            salt,
            publicKey,
            deviceId,
            [],
          ),
      ).toThrow('CryptoLib is required')
    })

    it('should throw an error if passphrase extra dictionary is not provided', () => {
      expect(
        () =>
          new TwoFaLib(
            deviceType,
            cryptoLib,
            // @ts-expect-error empty array is not a valid argument
            [],
            privateKey,
            symmetricKey,
            encryptedPrivateKey,
            encryptedSymmetricKey,
            salt,
            publicKey,
            deviceId,
            [],
          ),
      ).toThrow('Passphrase extra dictionary is required')
    })

    it('should create a TwoFaLib instance with valid parameters', () => {
      const twoFaLib = new TwoFaLib(
        deviceType,
        cryptoLib,
        ['test'],
        privateKey,
        symmetricKey,
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        publicKey,
        deviceId,
        [],
      )

      expect(twoFaLib).toBeInstanceOf(TwoFaLib)
      expect(twoFaLib.deviceType).toBe(deviceType)
    })
  })

  it('should save the current state when forceSave is called', async () => {
    await twoFaLib.forceSave()
    expect(mockPersistentStorageManager.save).toHaveBeenCalledWith()
  })

  it('should emit ready event after loading', async () => {
    const twoFaLib = new TwoFaLib(
      deviceType,
      cryptoLib,
      ['test'],
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      publicKey,
      deviceId,
      [],
    )

    const mockReadyFunction = vi.fn()
    twoFaLib.addEventListener(TwoFaLibEvent.Ready, mockReadyFunction)

    // Ceck if the ready event was emitted
    await vi.waitUntil(() => mockReadyFunction.mock.calls.length === 1, {
      timeout: 200,
      interval: 5,
    })

    // Clean up the event listener
    twoFaLib.removeEventListener(TwoFaLibEvent.Ready, mockReadyFunction)
  })
})
