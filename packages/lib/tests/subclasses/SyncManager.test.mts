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
  FavaLib,
  DeviceType,
  PrivateKey,
  SymmetricKey,
  PublicKey,
  EncryptedVaultStateString,
  PlatformProviders,
} from '../../src/main.mjs'

import {
  anotherNewTotpEntry,
  createFavaLibForTests,
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
} from '../../src/FavaLibError.mjs'
import type {
  DeviceFriendlyName,
  DeviceId,
} from '../../src/interfaces/SyncTypes.mjs'
import { FavaLibEvent } from '../../src/FavaLibEvent.mjs'
import { VaultServerMessage } from 'favaserver/ServerMessage'

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
  let senderFavaLib: FavaLib
  let receiverFavaLib: FavaLib
  let senderWsInstance: WsClient
  let receiverWsInstance: WsClient

  beforeAll(async () => {
    const result = await createFavaLibForTests()
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

    senderFavaLib = new FavaLib(
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
    void senderFavaLib.setSyncServerUrl(serverUrl)
    await server.connected
    await server.nextMessage // wait for the hello message

    await senderFavaLib.vault.addEntry(newTotpEntry)

    receiverFavaLib = new FavaLib(
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
    void receiverFavaLib.setSyncServerUrl(serverUrl)
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

    senderFavaLib.sync?.closeServerConnection()
    receiverFavaLib.sync?.closeServerConnection()
  })

  it('should initialize server connection', () => {
    expect(senderFavaLib.sync?.webSocketConnected).toBe(true)
    expect(receiverFavaLib.sync?.webSocketConnected).toBe(true)
  })

  it('should not be in add device flow initially', () => {
    expect(senderFavaLib.sync?.inAddDeviceFlow).toBe(false)
    expect(receiverFavaLib.sync?.inAddDeviceFlow).toBe(false)
  })

  it('should throw an error when initiating add device flow without server connection', async () => {
    const temporaryServerUrl = `${serverBaseUrl}:${serverPort + 1}`
    const temporaryServer = new WS(temporaryServerUrl)

    const disconnectedFavaLib = new FavaLib(
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
      disconnectedFavaLib.sync?.initiateAddDeviceFlow({
        qr: false,
        text: true,
      }),
    ).rejects.toThrow(SyncNoServerConnectionError)
  })

  it('should throw an error when initiating add device flow while another flow is active', async () => {
    const initiatePromise = senderFavaLib.sync?.initiateAddDeviceFlow({
      qr: false,
      text: true,
    })
    await server.nextMessage
    send(senderWsInstance, 'confirmAddSyncDeviceInitialiseData')

    await initiatePromise
    await expect(
      senderFavaLib.sync?.initiateAddDeviceFlow({ qr: false, text: true }),
    ).rejects.toThrow(SyncAddDeviceFlowConflictError)
  })

  it('should complete the full flow', async () => {
    if (!senderFavaLib.sync || !receiverFavaLib.sync) {
      // eslint-disable-next-line no-restricted-globals
      throw new Error('Sync manager not initialized')
    }

    const wsInstancesMap = new Map([
      [senderFavaLib.meta.deviceId, senderWsInstance],
      [receiverFavaLib.meta.deviceId, receiverWsInstance],
    ])

    // initiate the add device flow
    const initiateResultPromise = senderFavaLib.sync.initiateAddDeviceFlow({
      qr: false,
      text: true,
    })

    // wait for message to be received and send response
    await server.nextMessage
    send(senderWsInstance, 'confirmAddSyncDeviceInitialiseData')

    // get the initiateResult and pass it to the receiver (this part is usually done via QR)
    const initiateResult = await initiateResultPromise
    await receiverFavaLib.sync.respondToAddDeviceFlow(
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
    await vi.waitUntil(() => !receiverFavaLib.sync?.inAddDeviceFlow, {
      timeout: 200,
      interval: 5,
    })
    // nonces must be different
    const nonces = messageDatas.map((d) => (d as { nonce: string }).nonce)
    expect(new Set(nonces).size).toEqual(nonces.length)

    // receive the messages about adding the syncDevices
    const { syncCommandsExecutedMessages } = await handleSyncCommands(
      server,
      senderFavaLib.meta.deviceId,
      wsInstancesMap,
    )

    // received the syncCommandsExecuted message
    const syncCommandsExecutedMessage = syncCommandsExecutedMessages.get(
      receiverFavaLib.meta.deviceId,
    )
    expect(syncCommandsExecutedMessage).toEqual({
      type: 'syncCommandsExecuted',
      data: { commandIds: [expect.any(String)] },
    })

    expect(senderFavaLib.sync.inAddDeviceFlow).toBe(false)
    expect(receiverFavaLib.sync.inAddDeviceFlow).toBe(false)
    expect(receiverFavaLib.vault.listEntries()).toEqual(
      senderFavaLib.vault.listEntries(),
    )

    const senderSyncDevices = senderFavaLib.sync.getSyncDevices()
    const receiverSyncDevices = receiverFavaLib.sync.getSyncDevices()
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
        [senderFavaLib.meta.deviceId, senderWsInstance],
        [receiverFavaLib.meta.deviceId, receiverWsInstance],
      ])

      // this part actually takes the most time
      for (let i = 0; i < 1000; i += 1) {
        await senderFavaLib.vault.addEntry({
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
        senderFavaLib,
        receiverFavaLib,
        server,
        wsInstancesMap,
      })

      expect(senderFavaLib.sync?.getSyncDevices()).toHaveLength(1)
      expect(receiverFavaLib.sync?.getSyncDevices()).toHaveLength(1)
    },
    60 * 1000,
  )

  it('should sync commands between connected devices', async () => {
    const wsInstancesMap = new Map([
      [senderFavaLib.meta.deviceId, senderWsInstance],
      [receiverFavaLib.meta.deviceId, receiverWsInstance],
    ])

    await connectDevices({
      senderFavaLib,
      receiverFavaLib,
      server,
      wsInstancesMap,
    })

    // if we now add an entry to one of the libs, it should also be pushed to the other
    // const addedEntryId = await senderFavaLib.vault.addEntry(anotherTotpEntry)
    await senderFavaLib.vault.addEntry(anotherNewTotpEntry)

    const { syncCommandsExecutedMessages } = await handleSyncCommands(
      server,
      senderFavaLib.meta.deviceId,
      wsInstancesMap,
    )

    // received the syncCommandsExecuted message
    const syncCommandsExecutedMessage = syncCommandsExecutedMessages.get(
      receiverFavaLib.meta.deviceId,
    )
    expect(syncCommandsExecutedMessage).toEqual({
      type: 'syncCommandsExecuted',
      data: { commandIds: [expect.any(String)] },
    })

    await vi.waitUntil(() => receiverFavaLib.vault.size !== 1, {
      timeout: 1000,
      interval: 20,
    })
    expect(receiverFavaLib.vault.listEntries()).toEqual(
      senderFavaLib.vault.listEntries(),
    )

    // and the other way around
    const addedEntryId = await receiverFavaLib.vault.addEntry(totpEntry)

    // mock server
    const { syncCommandsExecutedMessages: syncCommandsExecutedMessages1 } =
      await handleSyncCommands(
        server,
        receiverFavaLib.meta.deviceId,
        wsInstancesMap,
      )
    const syncCommandsExecutedMessage1 = syncCommandsExecutedMessages1.get(
      senderFavaLib.meta.deviceId,
    )

    // entry should now be added
    await vi.waitUntil(() => senderFavaLib.vault.size !== 2, {
      timeout: 1000,
      interval: 20,
    })
    expect(senderFavaLib.vault.listEntries()).toEqual(
      receiverFavaLib.vault.listEntries(),
    )
    // confirmation of execution should be send
    expect(syncCommandsExecutedMessage1).toEqual({
      type: 'syncCommandsExecuted',
      data: { commandIds: [expect.any(String)] },
    })

    // if we delete an entry in one of the libs, it should also be deleted in the other
    await senderFavaLib.vault.deleteEntry(addedEntryId)

    // mock server
    await handleSyncCommands(
      server,
      senderFavaLib.meta.deviceId,
      wsInstancesMap,
    )

    await vi.waitUntil(() => receiverFavaLib.vault.size !== 3, {
      timeout: 1000,
      interval: 20,
    })

    expect(receiverFavaLib.vault.listEntries()).toEqual(
      senderFavaLib.vault.listEntries(),
    )
  })

  it('should emit ready event after receiving syncCommands message', async () => {
    const readyPromise = new Promise<void>((resolve) => {
      senderFavaLib.addEventListener(FavaLibEvent.Ready, () => resolve())
    })

    const newFavaLib = new FavaLib(
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

    newFavaLib.sync?.closeServerConnection()
  })

  it('should re-send unsent commands when connection is re-established', async () => {
    if (!senderFavaLib.sync) {
      // eslint-disable-next-line no-restricted-globals
      throw new Error('Sync manager not initialized')
    }

    const wsInstancesMap = new Map([
      [senderFavaLib.meta.deviceId, senderWsInstance],
      [receiverFavaLib.meta.deviceId, receiverWsInstance],
    ])

    expect(server.messagesToConsume.pendingItems).toHaveLength(0)
    await connectDevices({
      senderFavaLib,
      receiverFavaLib,
      server,
      wsInstancesMap,
    })

    // Add an entry while connected (should not be resend after the reconnect)
    await senderFavaLib.vault.addEntry(newTotpEntry)
    await handleSyncCommands(
      server,
      senderFavaLib.meta.deviceId,
      wsInstancesMap,
    )
    expect(server.messagesToConsume.pendingItems).toHaveLength(0)

    // Simulate disconnection
    senderWsInstance.close()

    // Add an entry while disconnected
    const addedEntryId = await senderFavaLib.vault.addEntry(anotherNewTotpEntry)
    send(senderWsInstance, 'syncCommands', [])
    expect(server.messagesToConsume.pendingItems).toHaveLength(0)

    // Simulate reconnection
    // @ts-expect-error Accessing private property for testing
    senderFavaLib.sync.ws.readyState = WebSocket.OPEN

    const connectMessage = (await server.nextMessage) as ConnectClientMessage
    expect(connectMessage.type).toBe('connect')
    send(senderWsInstance, 'syncCommands', [])

    // Wait for the command to be re-sent
    const { syncCommandsMessage } = await handleSyncCommands(
      server,
      senderFavaLib.meta.deviceId,
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
    await vi.waitUntil(() => receiverFavaLib.vault.size === 3, {
      timeout: 1000,
      interval: 20,
    })

    // Verify that both libraries have the same entries
    expect(receiverFavaLib.vault.listEntries()).toEqual(
      senderFavaLib.vault.listEntries(),
    )

    // Verify that the added entry exists in both libraries
    expect(senderFavaLib.vault.getEntryMeta(addedEntryId)).toBeTruthy()
    expect(receiverFavaLib.vault.getEntryMeta(addedEntryId)).toBeTruthy()
  }, 10000) // long running test, the re-connect itself takes 5 seconds

  it('should work with >2 devices', async () => {
    let otherReceiverWsInstance: WsClient
    const connectionPromise = new Promise<void>((resolve) => {
      server.on('connection', (client) => {
        otherReceiverWsInstance = client
        resolve()
      })
    })

    const otherReceiverFavaLib = new FavaLib(
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
      [senderFavaLib.meta.deviceId, senderWsInstance],
      [receiverFavaLib.meta.deviceId, receiverWsInstance],
      [otherReceiverFavaLib.meta.deviceId, otherReceiverWsInstance!],
    ])

    // connect first two
    await connectDevices({
      senderFavaLib,
      receiverFavaLib,
      server,
      wsInstancesMap,
    })

    // connect the 3rd
    await connectDevices({
      senderFavaLib,
      receiverFavaLib: otherReceiverFavaLib,
      server,
      wsInstancesMap,
    })

    expect(senderFavaLib.sync?.getSyncDevices()).toHaveLength(2)
    expect(receiverFavaLib.sync?.getSyncDevices()).toHaveLength(2)
    expect(otherReceiverFavaLib.sync?.getSyncDevices()).toHaveLength(2)

    const addedEntryId =
      await receiverFavaLib.vault.addEntry(anotherNewTotpEntry)

    await handleSyncCommands(
      server,
      senderFavaLib.meta.deviceId,
      wsInstancesMap,
    )

    // Wait for all to process the command
    await vi.waitUntil(
      () =>
        senderFavaLib.vault.size === 2 &&
        receiverFavaLib.vault.size === 2 &&
        otherReceiverFavaLib.vault.size === 2,
      {
        timeout: 1000,
        interval: 20,
      },
    )

    expect(senderFavaLib.vault.getEntryMeta(addedEntryId)).toBeTruthy()
    expect(receiverFavaLib.vault.getEntryMeta(addedEntryId)).toBeTruthy()
    expect(otherReceiverFavaLib.vault.getEntryMeta(addedEntryId)).toBeTruthy()

    // cleanup (rest of cleanup is done in afterEach)
    // @ts-expect-error we're force resetting
    otherReceiverWsInstance = null
    otherReceiverFavaLib.sync?.closeServerConnection()
  })

  it('should resilver when asked', async () => {
    const wsInstancesMap = new Map([
      [senderFavaLib.meta.deviceId, senderWsInstance],
      [receiverFavaLib.meta.deviceId, receiverWsInstance],
    ])

    await connectDevices({
      senderFavaLib,
      receiverFavaLib,
      server,
      wsInstancesMap,
    })

    await senderFavaLib.vault.addEntry({
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
    expect(senderFavaLib.vault.listEntries()).toHaveLength(2)
    expect(receiverFavaLib.vault.listEntries()).toHaveLength(1)

    await receiverFavaLib.sync!.requestResilver()
    const startResilverMessage =
      (await server.nextMessage) as StartResilverClientMessage
    expect(startResilverMessage).toEqual({
      type: 'startResilver',
      data: {
        deviceIds: expect.arrayContaining([
          senderFavaLib.meta.deviceId,
          receiverFavaLib.meta.deviceId,
        ]) as string[],
        nonce: expect.any(String) as string,
      },
    })

    send(senderWsInstance, 'startResilver', startResilverMessage.data)
    const senderResilverVaultMsg =
      (await server.nextMessage) as VaultServerMessage
    expect(senderResilverVaultMsg.data.forDeviceId).toEqual(
      receiverFavaLib.meta.deviceId,
    )

    send(receiverWsInstance, 'startResilver', startResilverMessage.data)
    const receiverResilverVaultMsg =
      (await server.nextMessage) as VaultServerMessage
    expect(receiverResilverVaultMsg.data.forDeviceId).toEqual(
      senderFavaLib.meta.deviceId,
    )

    send(receiverWsInstance, 'vault', {
      ...senderResilverVaultMsg.data,
      fromDeviceId: senderFavaLib.meta.deviceId,
    })
    send(senderWsInstance, 'vault', {
      ...receiverResilverVaultMsg.data,
      fromDeviceId: receiverFavaLib.meta.deviceId,
    })

    // Wait for all to process the resilver
    await vi.waitUntil(
      () =>
        senderFavaLib.vault.size === 2 &&
        receiverFavaLib.vault.size === 2 && {
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
      receiverFavaLib.sync!['handleServerMessage'](vaultMessage),
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
    receiverFavaLib.sync!['requestedResilver'] = true

    expect(() =>
      // eslint-disable-next-line @typescript-eslint/dot-notation
      receiverFavaLib.sync!['handleServerMessage'](vaultMessage),
    ).toThrow('Got vault data for the wrong device!')
  })
})
