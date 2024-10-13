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
  CryptoLib,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
  TwoFaLib,
  DeviceType,
} from '../../src/main.mjs'

import {
  anotherNewTotpEntry,
  createTwoFaLibForTests,
  passphrase,
  newTotpEntry,
  totpEntry,
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

const send = <T extends ServerMessage['type']>(
  ws: WsClient,
  type: T,
  data: unknown = {},
) => {
  ws.send(JSON.stringify({ type, data }))
}

describe('SyncManager', () => {
  let serverUrl: string
  let cryptoLib: CryptoLib
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
    salt = result.salt

    serverUrl = `${serverBaseUrl}:${serverPort}`
    server = new WS(serverUrl, { jsonProtocol: true })
  })

  beforeEach(async () => {
    // server.connected is broken, so we have to use this workaround
    const allConnected = new Promise<void>((resolve) => {
      server.on('connection', (client) => {
        if (!senderWsInstance) {
          senderWsInstance = client
        } else {
          receiverWsInstance = client
          resolve()
        }
      })
    })

    senderTwoFaLib = new TwoFaLib('sender' as DeviceType, cryptoLib, ['test'])
    const senderInitPromise = senderTwoFaLib.init(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
      'senderDeviceId' as DeviceId,
      undefined,
      serverUrl,
    )
    await server.connected
    await server.nextMessage // wait for the hello message
    await senderInitPromise

    await senderTwoFaLib.vault.addEntry(newTotpEntry)

    receiverTwoFaLib = new TwoFaLib('receiver' as DeviceType, cryptoLib, [
      'test',
    ])
    const receiverInitPromise = receiverTwoFaLib.init(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
      'receiverDeviceId' as DeviceId,
      undefined,
      serverUrl,
    )

    await allConnected
    await server.nextMessage // wait for the hello message
    await receiverInitPromise
  })

  afterEach(() => {
    // @ts-expect-error we're force resetting
    senderWsInstance = null
    // @ts-expect-error we're force resetting
    receiverWsInstance = null
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
    )
    await disconnectedTwoFaLib.init(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
      'tempDeviceId' as DeviceId,
      undefined,
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

    const message = (await server.nextMessage) as { data: unknown[] }
    send(receiverWsInstance, 'syncCommands', [message.data[0]])

    await vi.waitUntil(() => receiverTwoFaLib.vault.size !== 1, {
      timeout: 1000,
      interval: 20,
    })
    expect(receiverTwoFaLib.vault.listEntries()).toEqual(
      senderTwoFaLib.vault.listEntries(),
    )

    // receive the syncCommandsExecuted message
    expect(await server.nextMessage).toEqual({
      type: 'syncCommandsExecuted',
      data: { ids: [expect.any(String)] },
    })

    // and the other way around
    const addedEntryId = await receiverTwoFaLib.vault.addEntry(totpEntry)

    // mock server
    const message2 = (await server.nextMessage) as { data: unknown[] }
    send(senderWsInstance, 'syncCommands', [message2.data[0]])

    // entry should now be added
    await vi.waitUntil(() => senderTwoFaLib.vault.size !== 2, {
      timeout: 1000,
      interval: 20,
    })
    expect(senderTwoFaLib.vault.listEntries()).toEqual(
      receiverTwoFaLib.vault.listEntries(),
    )

    // receive the syncCommandsExecuted message
    expect(await server.nextMessage).toEqual({
      type: 'syncCommandsExecuted',
      data: { ids: [expect.any(String)] },
    })

    // if we delete an entry in one of the libs, it should also be deleted in the other
    await senderTwoFaLib.vault.deleteEntry(addedEntryId)

    // mock server
    const message3 = (await server.nextMessage) as { data: unknown[] }
    send(receiverWsInstance, 'syncCommands', [message3.data[0]])

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

    const newTwoFaLib = new TwoFaLib('newSender' as DeviceType, cryptoLib, [
      'test',
    ])
    await newTwoFaLib.init(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
      'newSenderDeviceId' as DeviceId,
      undefined,
      serverUrl,
    )

    await server.nextMessage // wait for the connect message
    send(senderWsInstance, 'syncCommands', [])

    // syncCommands message has been send, readyPromise should resolve soon
    await expect(readyPromise).resolves.toBeUndefined()
  })
})
