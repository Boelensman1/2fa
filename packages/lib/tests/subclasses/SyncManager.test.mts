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

import {
  CryptoLib,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
  TwoFaLib,
} from '../../src/main.mjs'

import {
  anotherTotpEntry,
  createTwoFaLibForTests,
  passphrase,
  totpEntry,
} from '../testUtils.js'
import { Client as WsClient } from 'mock-socket'
import {
  SyncAddDeviceFlowConflictError,
  SyncNoServerConnectionError,
} from '../../src/TwoFALibError.mjs'

// uses __mocks__/isomorphic-ws.js
vi.mock('isomorphic-ws')

const serverPort = 9770
const serverBaseUrl = 'ws://localhost'

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

    senderTwoFaLib = new TwoFaLib('sender', cryptoLib)
    await senderTwoFaLib.init(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
      serverUrl,
    )
    await server.connected // only the first server.connected works atm

    await senderTwoFaLib.vault.addEntry(totpEntry)

    receiverTwoFaLib = new TwoFaLib('receiver', cryptoLib)
    await receiverTwoFaLib.init(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
      serverUrl,
    )

    await allConnected
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
    const disconnectedTwoFaLib = new TwoFaLib('disconnected', cryptoLib)
    await disconnectedTwoFaLib.init(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
      temporaryServerUrl,
    )
    // await temporaryServer.connected
    temporaryServer.close()

    await expect(
      disconnectedTwoFaLib.sync?.initiateAddDeviceFlow(false),
    ).rejects.toThrow(SyncNoServerConnectionError)
  })

  it('should throw an error when initiating add device flow while another flow is active', async () => {
    const initiatePromise = senderTwoFaLib.sync?.initiateAddDeviceFlow(false)
    await server.nextMessage
    senderWsInstance.send(
      JSON.stringify({ type: 'addDeviceFlowRequestRegistered' }),
    )

    await initiatePromise
    await expect(
      senderTwoFaLib.sync?.initiateAddDeviceFlow(false),
    ).rejects.toThrow(SyncAddDeviceFlowConflictError)
  })

  it('should complete the full flow', async () => {
    if (!senderTwoFaLib.sync || !receiverTwoFaLib.sync) {
      throw new Error('Sync manager not initialized')
    }

    // initiate the add device flow
    const initiateResultPromise =
      senderTwoFaLib.sync.initiateAddDeviceFlow(false)

    // wait for message to be received and send response
    await server.nextMessage
    senderWsInstance.send(
      JSON.stringify({
        type: 'addDeviceFlowRequestRegistered',
      }),
    )

    // get the initiateResult and pass it to the receiver (this part is usually done via QR)
    const initiateResult = await initiateResultPromise
    await receiverTwoFaLib.sync.respondToAddDeviceFlow(initiateResult)

    // complete the rest of the flow
    const messages = [
      { type: 'addDevicePassPass2Result', sender: senderWsInstance },
      { type: 'addDevicePassPass3Result', sender: receiverWsInstance },
      { type: 'receivePublicKey', sender: senderWsInstance },
      { type: 'receiveInitialVaultData', sender: receiverWsInstance },
    ]
    const messageDatas = []
    for (const { type, sender } of messages) {
      const message = (await server.nextMessage) as { data: unknown }
      const data = message.data
      messageDatas.push(data)
      sender.send(
        JSON.stringify({
          type,
          data,
        }),
      )
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
    const addedEntryId = await senderTwoFaLib.vault.addEntry(anotherTotpEntry)
    await vi.waitUntil(() => receiverTwoFaLib.vault.size !== 1, {
      timeout: 1000,
      interval: 20,
    })
    expect(receiverTwoFaLib.vault.listEntries()).toEqual(
      senderTwoFaLib.vault.listEntries(),
    )

    // and the other way around
    await receiverTwoFaLib.vault.addEntry(totpEntry)
    await vi.waitUntil(() => senderTwoFaLib.vault.size !== 2, {
      timeout: 1000,
      interval: 20,
    })
    expect(senderTwoFaLib.vault.listEntries()).toEqual(
      receiverTwoFaLib.vault.listEntries(),
    )

    // if we delete an entry in one of the libs, it should also be deleted in the other
    await senderTwoFaLib.vault.deleteEntry(addedEntryId)
    await vi.waitUntil(() => receiverTwoFaLib.vault.size !== 2, {
      timeout: 1000,
      interval: 20,
    })
    expect(receiverTwoFaLib.vault.listEntries()).toEqual(
      senderTwoFaLib.vault.listEntries(),
    )
  })
})
