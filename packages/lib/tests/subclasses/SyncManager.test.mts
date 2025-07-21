import {
  describe,
  beforeAll,
  beforeEach,
  afterEach,
  it,
  vi,
  expect,
} from 'vitest'
import WS from 'vitest-websocket-mock'
export { WebSocket as default } from 'mock-socket'

import type ServerMessage from 'favaserver/ServerMessage'
import type {
  ConnectClientMessage,
  SyncCommandsClientMessage,
  StartResilverClientMessage,
} from 'favaserver/ClientMessage'
import {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
  TwoFaLib,
  DeviceType,
  PrivateKey,
  SymmetricKey,
  PublicKey,
  EncryptedVaultStateString,
  PlatformProviders,
} from '../../src/main.mjs'

import {
  anotherNewTotpEntry,
  createTwoFaLibForTests,
  newTotpEntry,
  totpEntry,
  send,
  connectDevices,
  handleSyncCommands,
} from '../testUtils.mjs'
import { Client as WsClient } from 'mock-socket'
import {
  SyncAddDeviceFlowConflictError,
  SyncNoServerConnectionError,
} from '../../src/TwoFALibError.mjs'
import type {
  DeviceFriendlyName,
  DeviceId,
} from '../../src/interfaces/SyncTypes.mjs'
import { TwoFaLibEvent } from '../../src/TwoFaLibEvent.mjs'
import { VaultServerMessage } from 'favaserver/ServerMessage'

// uses __mocks__/unws.js
vi.mock('unws')

const serverPort = 9770
const serverBaseUrl = 'ws://localhost'

describe('SyncManager', () => {
  let serverUrl: string
  let platformProviders: PlatformProviders
  let privateKey: PrivateKey
  let symmetricKey: SymmetricKey
  let publicKey: PublicKey
  let encryptedPrivateKey: EncryptedPrivateKey
  let encryptedSymmetricKey: EncryptedSymmetricKey
  let salt: Salt
  let server: WS
  let senderTwoFaLib: TwoFaLib
  let receiverTwoFaLib: TwoFaLib
  let senderWsInstance: WsClient
  let receiverWsInstance: WsClient

  beforeAll(async () => {
    const result = await createTwoFaLibForTests()
    platformProviders = result.platformProviders
    encryptedPrivateKey = result.encryptedPrivateKey
    encryptedSymmetricKey = result.encryptedSymmetricKey
    privateKey = result.privateKey
    symmetricKey = result.symmetricKey
    publicKey = result.publicKey
    salt = result.salt

    serverUrl = `${serverBaseUrl}:${serverPort}`
  })

  beforeEach(async () => {
    server = new WS(serverUrl, { jsonProtocol: true })
    // server.connected is broken, so we have to use this workaround
    const allConnected = new Promise<void>((resolve) => {
      server.on('connection', (client) => {
        if (!senderWsInstance) {
          senderWsInstance = client
        } else if (!receiverWsInstance) {
          receiverWsInstance = client
          resolve()
        }
      })
    })

    senderTwoFaLib = new TwoFaLib(
      'sender' as DeviceType,
      platformProviders,
      ['test'],
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      publicKey,
      {
        deviceId: 'senderDeviceId' as DeviceId,
        deviceFriendlyName: 'senderFriendlyName' as DeviceFriendlyName,
      },
      [],
    )
    void senderTwoFaLib.setSyncServerUrl(serverUrl)
    await server.connected
    await server.nextMessage // wait for the hello message

    await senderTwoFaLib.vault.addEntry(newTotpEntry)

    receiverTwoFaLib = new TwoFaLib(
      'receiver' as DeviceType,
      platformProviders,
      ['test'],
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      publicKey,
      {
        deviceId: 'receiverDeviceId' as DeviceId,
        deviceFriendlyName: 'receiverFriendlyName' as DeviceFriendlyName,
      },
      [],
    )
    void receiverTwoFaLib.setSyncServerUrl(serverUrl)
    await allConnected
    await server.nextMessage // wait for the hello message
  })

  afterEach(() => {
    // @ts-expect-error we're force resetting
    senderWsInstance = null
    // @ts-expect-error we're force resetting
    receiverWsInstance = null

    server.close()
    // @ts-expect-error we're force resetting
    server = null

    senderTwoFaLib.sync?.closeServerConnection()
    receiverTwoFaLib.sync?.closeServerConnection()
  })

  it('should initialize server connection', () => {
    expect(senderTwoFaLib.sync?.webSocketConnected).toBe(true)
    expect(receiverTwoFaLib.sync?.webSocketConnected).toBe(true)
  })

  it('should not be in add device flow initially', () => {
    expect(senderTwoFaLib.sync?.inAddDeviceFlow).toBe(false)
    expect(receiverTwoFaLib.sync?.inAddDeviceFlow).toBe(false)
  })

  it('should throw an error when initiating add device flow without server connection', async () => {
    const temporaryServerUrl = `${serverBaseUrl}:${serverPort + 1}`
    const temporaryServer = new WS(temporaryServerUrl)

    const disconnectedTwoFaLib = new TwoFaLib(
      'disconnected' as DeviceType,
      platformProviders,
      ['test'],
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      publicKey,
      { deviceId: 'disconnectedDeviceId' as DeviceId },
      [],
      undefined,
      { serverUrl: temporaryServerUrl, devices: [], commandSendQueue: [] },
    )

    // await temporaryServer.connected
    temporaryServer.close()

    await expect(
      disconnectedTwoFaLib.sync?.initiateAddDeviceFlow({
        qr: false,
        text: true,
      }),
    ).rejects.toThrow(SyncNoServerConnectionError)
  })

  it('should throw an error when initiating add device flow while another flow is active', async () => {
    const initiatePromise = senderTwoFaLib.sync?.initiateAddDeviceFlow({
      qr: false,
      text: true,
    })
    await server.nextMessage
    send(senderWsInstance, 'confirmAddSyncDeviceInitialiseData')

    await initiatePromise
    await expect(
      senderTwoFaLib.sync?.initiateAddDeviceFlow({ qr: false, text: true }),
    ).rejects.toThrow(SyncAddDeviceFlowConflictError)
  })

  it('should complete the full flow', async () => {
    if (!senderTwoFaLib.sync || !receiverTwoFaLib.sync) {
      // eslint-disable-next-line no-restricted-globals
      throw new Error('Sync manager not initialized')
    }

    const wsInstancesMap = new Map([
      [senderTwoFaLib.meta.deviceId, senderWsInstance],
      [receiverTwoFaLib.meta.deviceId, receiverWsInstance],
    ])

    // initiate the add device flow
    const initiateResultPromise = senderTwoFaLib.sync.initiateAddDeviceFlow({
      qr: false,
      text: true,
    })

    // wait for message to be received and send response
    await server.nextMessage
    send(senderWsInstance, 'confirmAddSyncDeviceInitialiseData')

    // get the initiateResult and pass it to the receiver (this part is usually done via QR)
    const initiateResult = await initiateResultPromise
    await receiverTwoFaLib.sync.respondToAddDeviceFlow(
      initiateResult.text,
      'text',
    )

    // complete the rest of the flow
    const messages: { type: ServerMessage['type']; sender: WsClient }[] = [
      { type: 'JPAKEPass2', sender: senderWsInstance },
      { type: 'JPAKEPass3', sender: receiverWsInstance },
      { type: 'publicKeyAndDeviceInfo', sender: senderWsInstance },
      { type: 'initialVault', sender: receiverWsInstance },
    ]
    const messageDatas = []
    for (const { type, sender } of messages) {
      const message = (await server.nextMessage) as { data: unknown }
      const data = message.data
      messageDatas.push(data)
      send(sender, type, data)
    }

    // wait for the import to finish
    await vi.waitUntil(() => !receiverTwoFaLib.sync?.inAddDeviceFlow, {
      timeout: 200,
      interval: 5,
    })
    // nonces must be different
    const nonces = messageDatas.map((d) => (d as { nonce: string }).nonce)
    expect(new Set(nonces).size).toEqual(nonces.length)

    // receive the messages about adding the syncDevices
    const { syncCommandsExecutedMessages } = await handleSyncCommands(
      server,
      senderTwoFaLib.meta.deviceId,
      wsInstancesMap,
    )

    // received the syncCommandsExecuted message
    const syncCommandsExecutedMessage = syncCommandsExecutedMessages.get(
      receiverTwoFaLib.meta.deviceId,
    )
    expect(syncCommandsExecutedMessage).toEqual({
      type: 'syncCommandsExecuted',
      data: { commandIds: [expect.any(String)] },
    })

    expect(senderTwoFaLib.sync.inAddDeviceFlow).toBe(false)
    expect(receiverTwoFaLib.sync.inAddDeviceFlow).toBe(false)
    expect(receiverTwoFaLib.vault.listEntries()).toEqual(
      senderTwoFaLib.vault.listEntries(),
    )

    const senderSyncDevices = senderTwoFaLib.sync.getSyncDevices()
    const receiverSyncDevices = receiverTwoFaLib.sync.getSyncDevices()
    expect(senderSyncDevices).toHaveLength(1)
    expect(receiverSyncDevices).toHaveLength(1)
    expect(senderSyncDevices[0]).toEqual({
      deviceId: 'receiverDeviceId' as DeviceId,
      deviceFriendlyName: 'receiverFriendlyName' as DeviceFriendlyName,
      deviceType: 'receiver',
    })
    expect(receiverSyncDevices[0]).toEqual({
      deviceId: 'senderDeviceId' as DeviceId,
      deviceFriendlyName: 'senderFriendlyName' as DeviceFriendlyName,
      deviceType: 'sender',
    })
  })

  it(
    'should work with a really big vault',
    async () => {
      const wsInstancesMap = new Map([
        [senderTwoFaLib.meta.deviceId, senderWsInstance],
        [receiverTwoFaLib.meta.deviceId, receiverWsInstance],
      ])

      // this part actually takes the most time
      for (let i = 0; i < 1000; i += 1) {
        await senderTwoFaLib.vault.addEntry({
          name: 'name'.repeat(10),
          type: 'TOTP',
          issuer: 'issuer'.repeat(10),
          payload: {
            digits: 8,
            period: 30,
            secret: 'secretsecret',
            algorithm: 'SHA-1',
          },
        })
      }

      await connectDevices({
        senderTwoFaLib,
        receiverTwoFaLib,
        server,
        wsInstancesMap,
      })

      expect(senderTwoFaLib.sync?.getSyncDevices()).toHaveLength(1)
      expect(receiverTwoFaLib.sync?.getSyncDevices()).toHaveLength(1)
    },
    60 * 1000,
  )

  it('should sync commands between connected devices', async () => {
    const wsInstancesMap = new Map([
      [senderTwoFaLib.meta.deviceId, senderWsInstance],
      [receiverTwoFaLib.meta.deviceId, receiverWsInstance],
    ])

    await connectDevices({
      senderTwoFaLib,
      receiverTwoFaLib,
      server,
      wsInstancesMap,
    })

    // if we now add an entry to one of the libs, it should also be pushed to the other
    // const addedEntryId = await senderTwoFaLib.vault.addEntry(anotherTotpEntry)
    await senderTwoFaLib.vault.addEntry(anotherNewTotpEntry)

    const { syncCommandsExecutedMessages } = await handleSyncCommands(
      server,
      senderTwoFaLib.meta.deviceId,
      wsInstancesMap,
    )

    // received the syncCommandsExecuted message
    const syncCommandsExecutedMessage = syncCommandsExecutedMessages.get(
      receiverTwoFaLib.meta.deviceId,
    )
    expect(syncCommandsExecutedMessage).toEqual({
      type: 'syncCommandsExecuted',
      data: { commandIds: [expect.any(String)] },
    })

    await vi.waitUntil(() => receiverTwoFaLib.vault.size !== 1, {
      timeout: 1000,
      interval: 20,
    })
    expect(receiverTwoFaLib.vault.listEntries()).toEqual(
      senderTwoFaLib.vault.listEntries(),
    )

    // and the other way around
    const addedEntryId = await receiverTwoFaLib.vault.addEntry(totpEntry)

    // mock server
    const { syncCommandsExecutedMessages: syncCommandsExecutedMessages1 } =
      await handleSyncCommands(
        server,
        receiverTwoFaLib.meta.deviceId,
        wsInstancesMap,
      )
    const syncCommandsExecutedMessage1 = syncCommandsExecutedMessages1.get(
      senderTwoFaLib.meta.deviceId,
    )

    // entry should now be added
    await vi.waitUntil(() => senderTwoFaLib.vault.size !== 2, {
      timeout: 1000,
      interval: 20,
    })
    expect(senderTwoFaLib.vault.listEntries()).toEqual(
      receiverTwoFaLib.vault.listEntries(),
    )
    // confirmation of execution should be send
    expect(syncCommandsExecutedMessage1).toEqual({
      type: 'syncCommandsExecuted',
      data: { commandIds: [expect.any(String)] },
    })

    // if we delete an entry in one of the libs, it should also be deleted in the other
    await senderTwoFaLib.vault.deleteEntry(addedEntryId)

    // mock server
    await handleSyncCommands(
      server,
      senderTwoFaLib.meta.deviceId,
      wsInstancesMap,
    )

    await vi.waitUntil(() => receiverTwoFaLib.vault.size !== 3, {
      timeout: 1000,
      interval: 20,
    })

    expect(receiverTwoFaLib.vault.listEntries()).toEqual(
      senderTwoFaLib.vault.listEntries(),
    )
  })

  it('should emit ready event after receiving syncCommands message', async () => {
    const readyPromise = new Promise<void>((resolve) => {
      senderTwoFaLib.addEventListener(TwoFaLibEvent.Ready, () => resolve())
    })

    const newTwoFaLib = new TwoFaLib(
      'newSender' as DeviceType,
      platformProviders,
      ['test'],
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      publicKey,
      { deviceId: 'newSenderDeviceId' as DeviceId },
      [],
      undefined,
      { serverUrl, devices: [], commandSendQueue: [] },
    )

    await server.nextMessage // wait for the connect message
    send(senderWsInstance, 'syncCommands', [])

    // syncCommands message has been send, readyPromise should resolve soon
    await expect(readyPromise).resolves.toBeUndefined()

    newTwoFaLib.sync?.closeServerConnection()
  })

  it('should re-send unsent commands when connection is re-established', async () => {
    if (!senderTwoFaLib.sync) {
      // eslint-disable-next-line no-restricted-globals
      throw new Error('Sync manager not initialized')
    }

    const wsInstancesMap = new Map([
      [senderTwoFaLib.meta.deviceId, senderWsInstance],
      [receiverTwoFaLib.meta.deviceId, receiverWsInstance],
    ])

    expect(server.messagesToConsume.pendingItems).toHaveLength(0)
    await connectDevices({
      senderTwoFaLib,
      receiverTwoFaLib,
      server,
      wsInstancesMap,
    })

    // Add an entry while connected (should not be resend after the reconnect)
    await senderTwoFaLib.vault.addEntry(newTotpEntry)
    await handleSyncCommands(
      server,
      senderTwoFaLib.meta.deviceId,
      wsInstancesMap,
    )
    expect(server.messagesToConsume.pendingItems).toHaveLength(0)

    // Simulate disconnection
    senderWsInstance.close()

    // Add an entry while disconnected
    const addedEntryId =
      await senderTwoFaLib.vault.addEntry(anotherNewTotpEntry)
    send(senderWsInstance, 'syncCommands', [])
    expect(server.messagesToConsume.pendingItems).toHaveLength(0)

    // Simulate reconnection
    // @ts-expect-error Accessing private property for testing
    senderTwoFaLib.sync.ws.readyState = WebSocket.OPEN

    const connectMessage = (await server.nextMessage) as ConnectClientMessage
    expect(connectMessage.type).toBe('connect')
    send(senderWsInstance, 'syncCommands', [])

    // Wait for the command to be re-sent
    const { syncCommandsMessage } = await handleSyncCommands(
      server,
      senderTwoFaLib.meta.deviceId,
      wsInstancesMap,
    )
    expect(syncCommandsMessage).toEqual({
      type: 'syncCommands',
      data: {
        nonce: expect.any(String) as string,
        commands: [
          expect.objectContaining({
            deviceId: expect.any(String) as string,
            encryptedSymmetricKey: expect.any(String) as string,
            encryptedCommand: expect.any(String) as string,
          }) as unknown,
        ],
      },
    })

    // Wait for the receiver to process the command
    await vi.waitUntil(() => receiverTwoFaLib.vault.size === 3, {
      timeout: 1000,
      interval: 20,
    })

    // Verify that both libraries have the same entries
    expect(receiverTwoFaLib.vault.listEntries()).toEqual(
      senderTwoFaLib.vault.listEntries(),
    )

    // Verify that the added entry exists in both libraries
    expect(senderTwoFaLib.vault.getEntryMeta(addedEntryId)).toBeTruthy()
    expect(receiverTwoFaLib.vault.getEntryMeta(addedEntryId)).toBeTruthy()
  }, 10000) // long running test, the re-connect itself takes 5 seconds

  it('should work with >2 devices', async () => {
    let otherReceiverWsInstance: WsClient
    const connectionPromise = new Promise<void>((resolve) => {
      server.on('connection', (client) => {
        otherReceiverWsInstance = client
        resolve()
      })
    })

    const otherReceiverTwoFaLib = new TwoFaLib(
      'otherReceiver' as DeviceType,
      platformProviders,
      ['test'],
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      publicKey,
      { deviceId: 'otherReceiverDeviceId' as DeviceId },
      [],
      undefined,
      { serverUrl, devices: [], commandSendQueue: [] },
    )

    await connectionPromise

    await server.nextMessage // wait for the hello message

    const wsInstancesMap = new Map([
      [senderTwoFaLib.meta.deviceId, senderWsInstance],
      [receiverTwoFaLib.meta.deviceId, receiverWsInstance],
      [otherReceiverTwoFaLib.meta.deviceId, otherReceiverWsInstance!],
    ])

    // connect first two
    await connectDevices({
      senderTwoFaLib,
      receiverTwoFaLib,
      server,
      wsInstancesMap,
    })

    // connect the 3rd
    await connectDevices({
      senderTwoFaLib,
      receiverTwoFaLib: otherReceiverTwoFaLib,
      server,
      wsInstancesMap,
    })

    expect(senderTwoFaLib.sync?.getSyncDevices()).toHaveLength(2)
    expect(receiverTwoFaLib.sync?.getSyncDevices()).toHaveLength(2)
    expect(otherReceiverTwoFaLib.sync?.getSyncDevices()).toHaveLength(2)

    const addedEntryId =
      await receiverTwoFaLib.vault.addEntry(anotherNewTotpEntry)

    await handleSyncCommands(
      server,
      senderTwoFaLib.meta.deviceId,
      wsInstancesMap,
    )

    // Wait for all to process the command
    await vi.waitUntil(
      () =>
        senderTwoFaLib.vault.size === 2 &&
        receiverTwoFaLib.vault.size === 2 &&
        otherReceiverTwoFaLib.vault.size === 2,
      {
        timeout: 1000,
        interval: 20,
      },
    )

    expect(senderTwoFaLib.vault.getEntryMeta(addedEntryId)).toBeTruthy()
    expect(receiverTwoFaLib.vault.getEntryMeta(addedEntryId)).toBeTruthy()
    expect(otherReceiverTwoFaLib.vault.getEntryMeta(addedEntryId)).toBeTruthy()

    // cleanup (rest of cleanup is done in afterEach)
    // @ts-expect-error we're force resetting
    otherReceiverWsInstance = null
    otherReceiverTwoFaLib.sync?.closeServerConnection()
  })

  it('should resilver when asked', async () => {
    const wsInstancesMap = new Map([
      [senderTwoFaLib.meta.deviceId, senderWsInstance],
      [receiverTwoFaLib.meta.deviceId, receiverWsInstance],
    ])

    await connectDevices({
      senderTwoFaLib,
      receiverTwoFaLib,
      server,
      wsInstancesMap,
    })

    await senderTwoFaLib.vault.addEntry({
      name: 'name',
      type: 'TOTP',
      issuer: 'issuer',
      payload: {
        digits: 8,
        period: 30,
        secret: 'secretsecret',
        algorithm: 'SHA-1',
      },
    })

    const syncCommandsMsg =
      (await server.nextMessage) as SyncCommandsClientMessage
    if (syncCommandsMsg.type !== 'syncCommands') {
      // eslint-disable-next-line no-restricted-globals
      throw new Error(
        `Wrong message received:\n ${JSON.stringify(syncCommandsMsg, null, 2)} `,
      )
    }
    // Send confirmation of received commands
    send(senderWsInstance, 'syncCommandsReceived', {
      commandIds: syncCommandsMsg.data.commands.map((c) => c.commandId),
    })

    // We don't actually send the command! The vaults are out of sync now
    expect(senderTwoFaLib.vault.listEntries()).toHaveLength(2)
    expect(receiverTwoFaLib.vault.listEntries()).toHaveLength(1)

    await receiverTwoFaLib.sync!.requestResilver()
    const startResilverMessage =
      (await server.nextMessage) as StartResilverClientMessage
    expect(startResilverMessage).toEqual({
      type: 'startResilver',
      data: {
        deviceIds: expect.arrayContaining([
          senderTwoFaLib.meta.deviceId,
          receiverTwoFaLib.meta.deviceId,
        ]) as string[],
        nonce: expect.any(String) as string,
      },
    })

    send(senderWsInstance, 'startResilver', startResilverMessage.data)
    const senderResilverVaultMsg =
      (await server.nextMessage) as VaultServerMessage
    expect(senderResilverVaultMsg.data.forDeviceId).toEqual(
      receiverTwoFaLib.meta.deviceId,
    )

    send(receiverWsInstance, 'startResilver', startResilverMessage.data)
    const receiverResilverVaultMsg =
      (await server.nextMessage) as VaultServerMessage
    expect(receiverResilverVaultMsg.data.forDeviceId).toEqual(
      senderTwoFaLib.meta.deviceId,
    )

    send(receiverWsInstance, 'vault', {
      ...senderResilverVaultMsg.data,
      fromDeviceId: senderTwoFaLib.meta.deviceId,
    })
    send(senderWsInstance, 'vault', {
      ...receiverResilverVaultMsg.data,
      fromDeviceId: receiverTwoFaLib.meta.deviceId,
    })

    // Wait for all to process the resilver
    await vi.waitUntil(
      () =>
        senderTwoFaLib.vault.size === 2 &&
        receiverTwoFaLib.vault.size === 2 && {
          timeout: 1000,
          interval: 20,
        },
    )
  })
  it('should error when vault data is received but no sync request was made', () => {
    const vaultMessage: VaultServerMessage = {
      type: 'vault',
      data: {
        forDeviceId: 'receiverDeviceId' as DeviceId,
        nonce: 'dazPAriJJIy5CaF7fRKrWA==',
        encryptedVaultData: '' as EncryptedVaultStateString,
        encryptedSymmetricKey: '' as EncryptedSymmetricKey,
        fromDeviceId: 'senderDeviceId' as DeviceId,
      },
    }
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/dot-notation
      receiverTwoFaLib.sync!['handleServerMessage'](vaultMessage),
    ).toThrow(
      'Got vault data while no resilver was requested, probably replay attack!',
    )
  })
  it('should error when vault data is received for the wrong deviceId', () => {
    const vaultMessage: VaultServerMessage = {
      type: 'vault',
      data: {
        forDeviceId: 'notReceiverDeviceId' as DeviceId,
        nonce: 'dazPAriJJIy5CaF7fRKrWA==',
        encryptedVaultData: '' as EncryptedVaultStateString,
        encryptedSymmetricKey: '' as EncryptedSymmetricKey,
        fromDeviceId: 'senderDeviceId' as DeviceId,
      },
    }

    // eslint-disable-next-line @typescript-eslint/dot-notation
    receiverTwoFaLib.sync!['requestedResilver'] = true

    expect(() =>
      // eslint-disable-next-line @typescript-eslint/dot-notation
      receiverTwoFaLib.sync!['handleServerMessage'](vaultMessage),
    ).toThrow('Got vault data for the wrong device!')
  })
})
