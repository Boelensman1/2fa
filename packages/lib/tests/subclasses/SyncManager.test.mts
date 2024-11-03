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

import type ServerMessage from '2faserver/ServerMessage'
import {
  ConnectMessage,
  SyncCommandsExecutedMessage,
  SyncCommandsMessage,
} from '2faserver/ClientMessage'
import {
  CryptoLib,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
  TwoFaLib,
  DeviceType,
  PrivateKey,
  SymmetricKey,
  PublicKey,
} from '../../src/main.mjs'

import {
  anotherNewTotpEntry,
  createTwoFaLibForTests,
  newTotpEntry,
  totpEntry,
  send,
  connectDevices,
} from '../testUtils.mjs'
import { Client as WsClient } from 'mock-socket'
import {
  SyncAddDeviceFlowConflictError,
  SyncNoServerConnectionError,
} from '../../src/TwoFALibError.mjs'
import type { DeviceId } from '../../src/interfaces/SyncTypes.mjs'
import { TwoFaLibEvent } from '../../src/TwoFaLibEvent.mjs'

// uses __mocks__/isomorphic-ws.js
vi.mock('isomorphic-ws')

const serverPort = 9770
const serverBaseUrl = 'ws://localhost'

const handleSyncCommands = async (
  server: WS,
  senderWsInstance: WsClient,
  receiverWsInstance: WsClient,
) => {
  // Wait for the command to be re-sent
  const syncCommandsMsg = (await server.nextMessage) as SyncCommandsMessage

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

  // Send commands to receiver
  send(receiverWsInstance, 'syncCommands', syncCommandsMsg.data.commands)

  const syncCommandsExecutedMsg =
    (await server.nextMessage) as SyncCommandsExecutedMessage

  return {
    syncCommandsMessage: syncCommandsMsg,
    syncCommandsExecutedMessage: syncCommandsExecutedMsg,
  }
}

describe('SyncManager', () => {
  let serverUrl: string
  let cryptoLib: CryptoLib
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
    cryptoLib = result.cryptoLib
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
      cryptoLib,
      ['test'],
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      publicKey,
      'senderDeviceId' as DeviceId,
      [],
      serverUrl,
    )
    await server.connected
    await server.nextMessage // wait for the hello message

    await senderTwoFaLib.vault.addEntry(newTotpEntry)

    receiverTwoFaLib = new TwoFaLib(
      'receiver' as DeviceType,
      cryptoLib,
      ['test'],
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      publicKey,
      'receiverDeviceId' as DeviceId,
      [],
      serverUrl,
    )
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
      cryptoLib,
      ['test'],
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      publicKey,
      'disconnectedDeviceId' as DeviceId,
      [],
      temporaryServerUrl,
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
      { type: 'publicKey', sender: senderWsInstance },
      { type: 'vault', sender: receiverWsInstance },
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

    expect(senderTwoFaLib.sync.inAddDeviceFlow).toBe(false)
    expect(receiverTwoFaLib.sync.inAddDeviceFlow).toBe(false)
    expect(receiverTwoFaLib.vault.listEntries()).toEqual(
      senderTwoFaLib.vault.listEntries(),
    )

    // nonces must be different
    const nonces = messageDatas.map((d) => (d as { nonce: string }).nonce)
    expect(new Set(nonces).size).toEqual(nonces.length)

    // if we now add an entry to one of the libs, it should also be pushed to the other
    // const addedEntryId = await senderTwoFaLib.vault.addEntry(anotherTotpEntry)
    await senderTwoFaLib.vault.addEntry(anotherNewTotpEntry)

    const { syncCommandsExecutedMessage } = await handleSyncCommands(
      server,
      senderWsInstance,
      receiverWsInstance,
    )

    await vi.waitUntil(() => receiverTwoFaLib.vault.size !== 1, {
      timeout: 1000,
      interval: 20,
    })
    expect(receiverTwoFaLib.vault.listEntries()).toEqual(
      senderTwoFaLib.vault.listEntries(),
    )

    // receive the syncCommandsExecuted message
    expect(syncCommandsExecutedMessage).toEqual({
      type: 'syncCommandsExecuted',
      data: { commandIds: [expect.any(String)] },
    })

    // and the other way around
    const addedEntryId = await receiverTwoFaLib.vault.addEntry(totpEntry)

    // mock server
    const { syncCommandsExecutedMessage: syncCommandsExecutedMessage1 } =
      await handleSyncCommands(server, receiverWsInstance, senderWsInstance)

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
    await handleSyncCommands(server, senderWsInstance, receiverWsInstance)

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
      cryptoLib,
      ['test'],
      privateKey,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      publicKey,
      'newSenderDeviceId' as DeviceId,
      [],
      serverUrl,
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
    expect(server.messagesToConsume.pendingItems).toHaveLength(0)
    await connectDevices({
      senderTwoFaLib,
      receiverTwoFaLib,
      server,
      senderWsInstance,
      receiverWsInstance,
    })

    // Add an entry while connected (should not be resend after the reconnect)
    await senderTwoFaLib.vault.addEntry(newTotpEntry)
    await handleSyncCommands(server, senderWsInstance, receiverWsInstance)
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

    const connectMessage = (await server.nextMessage) as ConnectMessage
    expect(connectMessage.type).toBe('connect')
    send(senderWsInstance, 'syncCommands', [])

    // Wait for the command to be re-sent
    const { syncCommandsMessage } = await handleSyncCommands(
      server,
      senderWsInstance,
      receiverWsInstance,
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
})
