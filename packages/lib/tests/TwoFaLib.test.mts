import { describe, it, expect, beforeEach, beforeAll, vi, Mock } from 'vitest'
import WS from 'vitest-websocket-mock'

import {
  DeviceType,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  TwoFaLib,
  Salt,
  PrivateKey,
  SymmetricKey,
  PublicKey,
  TwoFaLibEvent,
  DeviceId,
  PlatformProviders,
} from '../src/main.mjs'

import {
  clearEntries,
  createTwoFaLibForTests,
  deviceType,
  deviceId,
} from './testUtils.mjs'

// uses __mocks__/unws.js
vi.mock('unws')

describe('2falib', () => {
  let platformProviders: PlatformProviders
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
    platformProviders = result.platformProviders
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
            platformProviders,
            ['test'],
            privateKey,
            symmetricKey,
            encryptedPrivateKey,
            encryptedSymmetricKey,
            salt,
            publicKey,
            { deviceId },
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
            platformProviders,
            ['test'],
            privateKey,
            symmetricKey,
            encryptedPrivateKey,
            encryptedSymmetricKey,
            salt,
            publicKey,
            { deviceId },
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
            { deviceId },
            [],
          ),
      ).toThrow('CryptoLib is required')
    })

    it('should throw an error if passphrase extra dictionary is not provided', () => {
      expect(
        () =>
          new TwoFaLib(
            deviceType,
            platformProviders,
            // @ts-expect-error empty array is not a valid argument
            [],
            privateKey,
            symmetricKey,
            encryptedPrivateKey,
            encryptedSymmetricKey,
            salt,
            publicKey,
            { deviceId },
            [],
          ),
      ).toThrow('Passphrase extra dictionary is required')
    })

    it('should create a TwoFaLib instance with valid parameters', () => {
      const twoFaLib = new TwoFaLib(
        deviceType,
        platformProviders,
        ['test'],
        privateKey,
        symmetricKey,
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        publicKey,
        { deviceId },
        [],
      )

      expect(twoFaLib).toBeInstanceOf(TwoFaLib)
      expect(twoFaLib.deviceType).toBe(deviceType)
    })
  })

  it('should save the current state when forceSave is called', async () => {
    await twoFaLib.storage.forceSave()
    expect(mockPersistentStorageManager.save).toHaveBeenCalledWith()
  })

  it('should emit ready event after loading', async () => {
    const twoFaLib = new TwoFaLib(
      deviceType,
      platformProviders,
      ['test'],
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      publicKey,
      { deviceId },
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

  describe('setSyncServerUrl', () => {
    it('should properly set server url and initialize sync manager', async () => {
      const newServerUrl = 'ws://newserver:1234'
      const server = new WS(newServerUrl, { jsonProtocol: true })

      const twoFaLib = new TwoFaLib(
        deviceType,
        platformProviders,
        ['test'],
        privateKey,
        symmetricKey,
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        publicKey,
        { deviceId: 'testDeviceId' as DeviceId },
        [],
      )

      const mockCloseServerConnection = vi.fn()
      const mockSyncManager = {
        closeServerConnection: mockCloseServerConnection,
      }
      const mockSave = vi.fn()
      // @ts-expect-error Accessing private property for testing
      twoFaLib.mediator.components.persistentStorageManager.save = mockSave

      // @ts-expect-error Accessing private property for testing
      twoFaLib.mediator.registerComponent('syncManager', mockSyncManager)

      await twoFaLib.setSyncServerUrl(newServerUrl)

      // Should close existing connection
      expect(mockCloseServerConnection).toHaveBeenCalledOnce()

      // Wait for connection and hello message
      await server.nextMessage // wait for the hello message

      // Should have created a new sync manager with correct url
      const syncManager = twoFaLib.sync
      expect(syncManager).toBeDefined()
      expect(syncManager?.serverUrl).toBe(newServerUrl)

      // Should have initialized websocket connection
      expect(syncManager?.webSocketConnected).toBe(true)

      // should have saved
      expect(mockSave).toHaveBeenCalledOnce()
      expect(twoFaLib.sync?.serverUrl).toBe(newServerUrl)

      // Clean up
      server.close()
      syncManager?.closeServerConnection()
    })

    it('should maintain old url if connection fails and force is false', async () => {
      const originalUrl = 'ws://original:1234'
      const newUrl = 'ws://unreachable:1234'

      const server = new WS(originalUrl, { jsonProtocol: true })

      const twoFaLib = new TwoFaLib(
        deviceType,
        platformProviders,
        ['test'],
        privateKey,
        symmetricKey,
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        publicKey,
        { deviceId: 'testDeviceId' as DeviceId },
        [],
      )

      // Set initial URL
      await twoFaLib.setSyncServerUrl(originalUrl)
      await server.nextMessage

      // Attempt to set new URL without force
      await expect(twoFaLib.setSyncServerUrl(newUrl)).rejects.toThrow(
        'Failed to connect to server at ws://unreachable:1234, not setting',
      )
      expect(twoFaLib.sync?.serverUrl).toBe(originalUrl)

      // Clean up
      twoFaLib.sync?.closeServerConnection()
      server.close()
    })

    it('should update url if connection fails but force is true', async () => {
      const originalUrl = 'ws://original:1234'
      const newUrl = 'ws://unreachable:1234'

      const server = new WS(originalUrl, { jsonProtocol: true })

      const twoFaLib = new TwoFaLib(
        deviceType,
        platformProviders,
        ['test'],
        privateKey,
        symmetricKey,
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        publicKey,
        { deviceId: 'testDeviceId' as DeviceId },
        [],
      )

      // Set initial URL
      await twoFaLib.setSyncServerUrl(originalUrl)
      await server.nextMessage

      // Attempt to set new URL without force
      await twoFaLib.setSyncServerUrl(newUrl, true)
      expect(twoFaLib.sync?.serverUrl).toBe(newUrl)

      // Clean up
      twoFaLib.sync?.closeServerConnection()
      server.close()
    })
  })
})
