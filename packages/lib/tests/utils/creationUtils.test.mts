import { describe, it, expect, beforeAll, vi } from 'vitest'
import {
  FavaLib,
  getFavaLibVaultCreationUtils,
  type DeviceId,
  type Password,
  LockedRepresentationString,
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
