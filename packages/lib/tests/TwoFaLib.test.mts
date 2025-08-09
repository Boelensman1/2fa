import { describe, it, expect, beforeEach, beforeAll, vi, Mock } from 'vitest'
import WS from 'vitest-websocket-mock'

import {
  DeviceType,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  FavaLib,
  Salt,
  PrivateKey,
  SymmetricKey,
  PublicKey,
  FavaLibEvent,
  DeviceId,
  PlatformProviders,
} from '../src/main.mjs'

import {
  clearEntries,
  createFavaLibForTests,
  deviceType,
  deviceId,
} from './testUtils.mjs'

describe('2falib', () => {
  let platformProviders: PlatformProviders
  let favaLib: FavaLib
  let mockPersistentStorageManager: { save: Mock; init: Mock }
  let privateKey: PrivateKey
  let symmetricKey: SymmetricKey
  let publicKey: PublicKey
  let encryptedPrivateKey: EncryptedPrivateKey
  let encryptedSymmetricKey: EncryptedSymmetricKey
  let salt: Salt

  beforeAll(async () => {
    const result = await createFavaLibForTests()
    favaLib = result.favaLib
    platformProviders = result.platformProviders
    encryptedPrivateKey = result.encryptedPrivateKey
    encryptedSymmetricKey = result.encryptedSymmetricKey
    privateKey = result.privateKey
    symmetricKey = result.symmetricKey
    publicKey = result.publicKey
    salt = result.salt
  })

  beforeEach(async () => {
    await clearEntries(favaLib)
    mockPersistentStorageManager = {
      save: vi.fn(),
      init: vi.fn().mockResolvedValue({ publicKey: null, privateKey: null }),
    }
    // @ts-expect-error: Overriding private property for testing
    favaLib.mediator.components.persistentStorageManager =
      mockPersistentStorageManager
  })

  describe('FavaLib constructor', () => {
    it('should throw an error if device type is not provided', () => {
      expect(
        () =>
          new FavaLib(
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
          new FavaLib(
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
          new FavaLib(
            deviceType,
            // @ts-expect-error null is not a valid argument for FavaLib
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

    it('should throw an error if password extra dictionary is not provided', () => {
      expect(
        () =>
          new FavaLib(
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
      ).toThrow('Password extra dictionary is required')
    })

    it('should create a FavaLib instance with valid parameters', () => {
      const favaLib = new FavaLib(
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

      expect(favaLib).toBeInstanceOf(FavaLib)
      expect(favaLib.deviceType).toBe(deviceType)
    })
  })

  it('should save the current state when forceSave is called', async () => {
    await favaLib.storage.forceSave()
    expect(mockPersistentStorageManager.save).toHaveBeenCalledWith()
  })

  it('should emit ready event after loading', async () => {
    const favaLib = new FavaLib(
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
    favaLib.addEventListener(FavaLibEvent.Ready, mockReadyFunction)

    // Ceck if the ready event was emitted
    await vi.waitUntil(() => mockReadyFunction.mock.calls.length === 1, {
      timeout: 200,
      interval: 5,
    })

    // Clean up the event listener
    favaLib.removeEventListener(FavaLibEvent.Ready, mockReadyFunction)
  })

  describe('setSyncServerUrl', () => {
    it('should properly set server url and initialize sync manager', async () => {
      const newServerUrl = 'ws://newserver:1234'
      const server = new WS(newServerUrl, { jsonProtocol: true })

      const favaLib = new FavaLib(
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

      // create a fake existing sync manager to check that the previous connection is correctly closed
      const mockCloseServerConnection = vi.fn()
      const mockExistingSyncManager = {
        closeServerConnection: mockCloseServerConnection,
        initServerConnection: mockCloseServerConnection, // temporarily mock this too so we don't get an error when reconnecting after the connection fails
      }
      const mockSave = vi.fn()
      // @ts-expect-error Accessing private property for testing
      favaLib.mediator.components.persistentStorageManager.save = mockSave

      // @ts-expect-error Accessing private property for testing
      favaLib.mediator.registerComponent(
        'syncManager',
        // @ts-expect-error mockExistingSyncManager only has closeServerConnection property
        mockExistingSyncManager,
      )

      await favaLib.setSyncServerUrl(newServerUrl)

      // Should close existing connection
      expect(mockCloseServerConnection).toHaveBeenCalledOnce()

      // Wait for connection and hello message
      await server.nextMessage // wait for the hello message

      // Should have created a new sync manager with correct url
      const syncManager = favaLib.sync
      expect(syncManager).toBeDefined()
      expect(syncManager?.serverUrl).toBe(newServerUrl)

      // Should have initialized websocket connection
      expect(syncManager?.webSocketConnected).toBe(true)

      // should have saved
      expect(mockSave).toHaveBeenCalledOnce()
      expect(favaLib.sync?.serverUrl).toBe(newServerUrl)

      // Clean up
      server.close()
      syncManager?.closeServerConnection()
    })

    it('should maintain old url if connection fails and force is false', async () => {
      const originalUrl = 'ws://original:1234'
      const newUrl = 'ws://unreachable:1234'

      const server = new WS(originalUrl, { jsonProtocol: true })

      const favaLib = new FavaLib(
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
      await favaLib.setSyncServerUrl(originalUrl)
      await server.nextMessage

      // Attempt to set new URL without force
      await expect(favaLib.setSyncServerUrl(newUrl)).rejects.toThrow(
        'Failed to connect to server at ws://unreachable:1234, not setting',
      )
      expect(favaLib.sync?.serverUrl).toBe(originalUrl)

      // Clean up
      favaLib.sync?.closeServerConnection()
      server.close()
    })

    it('should update url if connection fails but force is true', async () => {
      const originalUrl = 'ws://original:1234'
      const newUrl = 'ws://unreachable:1234'

      const server = new WS(originalUrl, { jsonProtocol: true })

      const favaLib = new FavaLib(
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
      await favaLib.setSyncServerUrl(originalUrl)
      await server.nextMessage

      // Attempt to set new URL without force
      await favaLib.setSyncServerUrl(newUrl, true)
      expect(favaLib.sync?.serverUrl).toBe(newUrl)

      // Clean up
      favaLib.sync?.closeServerConnection()
      server.close()
    })
  })
})
