import { describe, it, expect, beforeAll, vi } from 'vitest'
import {
  FavaLib,
  getFavaLibVaultCreationUtils,
  type DeviceId,
  type Password,
  LockedRepresentationString,
  StorageVersionError,
} from '../../src/main.mjs'
import {
  createFavaLibForTests,
  newTotpEntry,
  deviceType,
  deviceId,
  password,
  passwordExtraDict,
} from '../testUtils.mjs'
import { nodeProviders } from '../../src/platformProviders/node/index.mjs'

describe('creationUtils', () => {
  let creationUtils: ReturnType<typeof getFavaLibVaultCreationUtils>
  let lockedRepresentation: LockedRepresentationString

  beforeAll(async () => {
    const saveFunction = (
      newLockedRepresentation: LockedRepresentationString,
    ) => {
      lockedRepresentation = newLockedRepresentation
    }

    const result = await createFavaLibForTests(saveFunction)

    await result.favaLib.storage.forceSave()

    creationUtils = getFavaLibVaultCreationUtils(
      nodeProviders,
      deviceType,
      passwordExtraDict,
    )
  })

  // Your existing tests
  it('should throw an error on invalid password', async () => {
    await expect(
      creationUtils.loadFavaLibFromLockedRepesentation(
        lockedRepresentation,
        'not-the-password' as Password,
      ),
    ).rejects.toThrow('Invalid password')
  })

  describe('storageVersion guard', () => {
    const withStorageVersion = (value: unknown): LockedRepresentationString => {
      const parsed = JSON.parse(lockedRepresentation) as Record<string, unknown>
      parsed.storageVersion = value
      return JSON.stringify(parsed) as LockedRepresentationString
    }

    it('refuses a vault written by a newer library', async () => {
      await expect(
        creationUtils.loadFavaLibFromLockedRepesentation(
          withStorageVersion(99),
          password,
        ),
      ).rejects.toThrow(StorageVersionError)
    })

    it('says what is wrong and tells the user not to reset', async () => {
      await expect(
        creationUtils.loadFavaLibFromLockedRepesentation(
          withStorageVersion(99),
          password,
        ),
      ).rejects.toThrow(/storage version 99.*only supports up to 1/s)
    })

    it('refuses before attempting any decryption', async () => {
      // The wrong password would normally produce 'Invalid password'. Getting
      // the version error instead is what proves the guard runs first -- which
      // matters because a future format must not reach decryptKeys at all.
      await expect(
        creationUtils.loadFavaLibFromLockedRepesentation(
          withStorageVersion(99),
          'not-the-password' as Password,
        ),
      ).rejects.toThrow(StorageVersionError)
    })

    it.each([
      ['a numeric string', '2'],
      ['a non-integer', 1.5],
      ['zero', 0],
      ['a negative number', -1],
      ['null', null],
      ['an object', {}],
    ])('rejects %s as an invalid storageVersion', async (_label, value) => {
      // '2' is the case that matters most: reading the field through the
      // Partial<LockedRepresentation> cast would coerce it, making '2' > 1
      // true and giving the right answer for the wrong reason.
      await expect(
        creationUtils.loadFavaLibFromLockedRepesentation(
          withStorageVersion(value),
          password,
        ),
      ).rejects.toThrow(StorageVersionError)
    })

    it('treats an absent storageVersion as the legacy version', async () => {
      const parsed = JSON.parse(lockedRepresentation) as Record<string, unknown>
      delete parsed.storageVersion
      const favaLib = await creationUtils.loadFavaLibFromLockedRepesentation(
        JSON.stringify(parsed) as LockedRepresentationString,
        password,
        { connectToSyncServer: false },
      )
      await favaLib.ready
      expect(favaLib.meta.deviceId).toBeTruthy()
      favaLib.sync?.closeServerConnection()
    })

    it('ignores libVersion entirely', async () => {
      // libVersion records which build wrote the vault; it must never decide
      // whether one opens, or a newer library would refuse its own vaults.
      const parsed = JSON.parse(lockedRepresentation) as Record<string, unknown>
      parsed.libVersion = '99.0.0'
      const favaLib = await creationUtils.loadFavaLibFromLockedRepesentation(
        JSON.stringify(parsed) as LockedRepresentationString,
        password,
        { connectToSyncServer: false },
      )
      await favaLib.ready
      expect(favaLib.meta.deviceId).toBeTruthy()
      favaLib.sync?.closeServerConnection()
    })
  })

  it('loads offline without a socket and persists queued commands', async () => {
    const result = await createFavaLibForTests()
    const WebSocketLib = vi.fn(nodeProviders.WebSocketLib)
    const offlineProviders = { ...nodeProviders, WebSocketLib }
    let savedRepresentation: LockedRepresentationString | undefined

    const offlineFavaLib = new FavaLib(
      deviceType,
      offlineProviders,
      passwordExtraDict,
      result.privateKey,
      result.symmetricKey,
      result.encryptedPrivateKey,
      result.encryptedSymmetricKey,
      result.salt,
      result.publicKey,
      { deviceId },
      [],
      (representation) => {
        savedRepresentation = representation
      },
      {
        serverUrl: 'ws://offline.test',
        devices: [
          {
            deviceId: 'other-device' as DeviceId,
            publicKey: result.publicKey,
            deviceInfo: { deviceType },
          },
        ],
        commandSendQueue: [],
      },
      false,
    )

    await offlineFavaLib.ready
    await offlineFavaLib.vault.addEntry(newTotpEntry)

    expect(WebSocketLib).not.toHaveBeenCalled()
    expect(offlineFavaLib.sync?.getCommandSendQueue()).toHaveLength(1)
    expect(savedRepresentation).toBeDefined()

    const offlineCreationUtils = getFavaLibVaultCreationUtils(
      offlineProviders,
      deviceType,
      passwordExtraDict,
    )
    const reloadedFavaLib =
      await offlineCreationUtils.loadFavaLibFromLockedRepesentation(
        savedRepresentation!,
        password,
        { connectToSyncServer: false },
      )

    await reloadedFavaLib.ready
    expect(WebSocketLib).not.toHaveBeenCalled()
    expect(reloadedFavaLib.vault.size).toBe(1)
    expect(reloadedFavaLib.sync?.getCommandSendQueue()).toHaveLength(1)
    reloadedFavaLib.sync?.closeServerConnection()
  })
})
