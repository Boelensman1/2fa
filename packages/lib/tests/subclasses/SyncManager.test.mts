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

import type ServerMessage from '../../src/interfaces/protocol/ServerMessage.mjs'
import type {
  ConnectClientMessage,
  SyncCommandsClientMessage,
  StartResilverClientMessage,
} from '../../src/interfaces/protocol/ClientMessage.mjs'
import {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
  MacKey,
  KdfParameters,
  FavaLib,
  DeviceType,
  PrivateKey,
  SymmetricKey,
  PublicKey,
  EncryptedVaultStateString,
  PlatformProviders,
  type EntryId,
} from '../../src/main.mjs'
import {
  base64ToString,
  base64ToUint8Array,
  stringToBase64,
  uint8ArrayToBase64,
} from 'uint8array-extras'
import { nodeProviders } from '../../src/platformProviders/node/index.mjs'
import { buildCommandAad } from '../../src/utils/canonical.mjs'
import type { SyncCommand } from '../../src/interfaces/CommandTypes.mjs'

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
  SyncPairingVersionError,
} from '../../src/FavaLibError.mjs'
import { PAIRING_VERSION } from '../../src/version.mjs'
import type {
  DeviceFriendlyName,
  DeviceId,
  SyncDevice,
} from '../../src/interfaces/SyncTypes.mjs'
import { MAX_SYNC_DEVICES } from '../../src/utils/syncDeviceValidation.mjs'
import { FavaLibEvent } from '../../src/FavaLibEvent.mjs'
import type { VaultServerMessage } from '../../src/interfaces/protocol/ServerMessage.mjs'

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
  let macKey: MacKey
  let kdf: KdfParameters
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
    macKey = result.macKey
    kdf = result.kdf
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
      macKey,
      kdf,
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
      macKey,
      kdf,
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
      macKey,
      kdf,
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

  describe('pairing version', () => {
    /**
     * Runs an initiator far enough to hand out its pairing payload.
     * @returns The payload as the connection-string text an initiator shows.
     */
    const getInitiatorText = async () => {
      const initiateResultPromise = senderFavaLib.sync!.initiateAddDeviceFlow({
        qr: false,
        text: true,
      })
      await server.nextMessage
      send(senderWsInstance, 'confirmAddSyncDeviceInitialiseData')
      return (await initiateResultPromise).text
    }

    /**
     * Rewrites the pairingVersion of a payload, or drops it entirely.
     * @param text - The connection-string text to rewrite.
     * @param pairingVersion - The version to stamp, or undefined to drop it.
     * @returns The rewritten connection-string text.
     */
    const restamp = (text: string, pairingVersion: string | undefined) => {
      const payload = JSON.parse(base64ToString(text)) as Record<
        string,
        unknown
      >
      if (pairingVersion === undefined) {
        delete payload.pairingVersion
      } else {
        payload.pairingVersion = pairingVersion
      }
      return stringToBase64(JSON.stringify(payload), { urlSafe: true })
    }

    it('should stamp the pairing version onto the initiator payload', async () => {
      const payload = JSON.parse(
        base64ToString(await getInitiatorText()),
      ) as Record<string, unknown>

      expect(payload.pairingVersion).toBe(PAIRING_VERSION)
    })

    it('should refuse a payload from a peer that predates the pairing version', async () => {
      const text = restamp(await getInitiatorText(), undefined)

      // An absent field means a build on jpake-ts 1.x, whose proofs this one
      // rejects -- so the other device is the one that has to be updated.
      await expect(
        receiverFavaLib.sync!.respondToAddDeviceFlow(text, 'text'),
      ).rejects.toThrow(SyncPairingVersionError)
      await expect(
        receiverFavaLib.sync!.respondToAddDeviceFlow(text, 'text'),
      ).rejects.toThrow(/update the other device/)
      expect(receiverFavaLib.sync!.inAddDeviceFlow).toBe(false)
    })

    it('should refuse a payload from a newer peer', async () => {
      const text = restamp(await getInitiatorText(), '3.0')

      await expect(
        receiverFavaLib.sync!.respondToAddDeviceFlow(text, 'text'),
      ).rejects.toThrow(/update this device/)
      expect(receiverFavaLib.sync!.inAddDeviceFlow).toBe(false)
    })

    it('should refuse a payload whose pairing version does not parse', async () => {
      const text = restamp(await getInitiatorText(), 'not-a-version')

      await expect(
        receiverFavaLib.sync!.respondToAddDeviceFlow(text, 'text'),
      ).rejects.toThrow(SyncPairingVersionError)
      expect(receiverFavaLib.sync!.inAddDeviceFlow).toBe(false)
    })

    it('should accept a payload that differs only in the minor version', async () => {
      const text = restamp(
        await getInitiatorText(),
        `${PAIRING_VERSION.split('.')[0]}.99`,
      )

      await expect(
        receiverFavaLib.sync!.respondToAddDeviceFlow(text, 'text'),
      ).resolves.toBeUndefined()
      expect(receiverFavaLib.sync!.inAddDeviceFlow).toBe(true)
    })
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

  it("should sync an entry's matchers between devices", async () => {
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

    const entryId = await senderFavaLib.vault.addEntry({
      ...anotherNewTotpEntry,
      matchers: [{ type: 'BaseDomain', value: 'github.com' }],
      url: 'https://github.com/login',
      inputSelector: '#otp',
    })

    await handleSyncCommands(
      server,
      senderFavaLib.meta.deviceId,
      wsInstancesMap,
    )

    await vi.waitUntil(() => receiverFavaLib.vault.size !== 1, {
      timeout: 1000,
      interval: 20,
    })

    const received = receiverFavaLib.vault.getEntryMeta(entryId)
    expect(received.matchers).toEqual([
      { type: 'BaseDomain', value: 'github.com' },
    ])
    expect(received.url).toBe('https://github.com/login')
    expect(received.inputSelector).toBe('#otp')
    expect(
      receiverFavaLib.vault.findEntriesForUrl('https://gist.github.com/x'),
    ).toEqual([entryId])
  })

  const getReceiverCommandManager = () =>
    (
      receiverFavaLib as unknown as {
        mediator: {
          getComponent: (name: 'commandManager') => {
            receiveRemoteCommand: (command: SyncCommand) => void
            processRemoteCommands: () => Promise<string[]>
          }
        }
      }
    ).mediator.getComponent('commandManager')

  const makeRemoteEntry = (entryId: EntryId) => ({
    id: entryId,
    name: 'Remote TOTP',
    issuer: 'Remote Issuer',
    type: 'TOTP',
    matchers: [],
    url: null,
    inputSelector: null,
    addedAt: Date.now(),
    updatedAt: null,
    payload: {
      secret: 'REMOTESECRET',
      period: 30,
      algorithm: 'SHA-1',
      digits: 6,
    },
  })

  it('should repair, not drop, a remote entry carrying an unusable matcher', async () => {
    // processRemoteCommands drops a command that throws and never retries it,
    // so an entry arriving with a bad matcher has to land sanitised instead.
    const entryId = 'remote-entry' as EntryId

    const receiverCommandManager = getReceiverCommandManager()

    receiverCommandManager.receiveRemoteCommand({
      id: 'remote-command',
      type: 'AddEntry',
      timestamp: Date.now(),
      version: '1.0',
      data: {
        id: entryId,
        name: 'Remote TOTP',
        issuer: 'Remote Issuer',
        type: 'TOTP',
        matchers: [
          { type: 'Regex', value: '(a+)+' },
          { type: 'Nope', value: 'x' },
          { type: 'Host', value: 'keep.me' },
        ],
        url: 'x'.repeat(9000),
        inputSelector: '#otp\nbody',
        addedAt: Date.now(),
        updatedAt: null,
        payload: {
          secret: 'REMOTESECRET',
          period: 30,
          algorithm: 'SHA-1',
          digits: 6,
        },
      },
    } as unknown as SyncCommand)

    await receiverCommandManager.processRemoteCommands()

    const received = receiverFavaLib.vault.getEntryMeta(entryId)
    expect(received.matchers).toEqual([{ type: 'Host', value: 'keep.me' }])
    expect(received.url).toBeNull()
    expect(received.inputSelector).toBeNull()
    expect(received.name).toBe('Remote TOTP')
  })

  it.each([
    ['an explicit current version', '2.0'],
    ['a newer minor version', '2.7'],
    ['the previous major, now legacy', '1.0'],
    ['no version at all', undefined],
  ])('should apply a remote command with %s', async (_label, version) => {
    const entryId = `version-ok-${String(version)}` as EntryId
    const receiverCommandManager = getReceiverCommandManager()

    receiverCommandManager.receiveRemoteCommand({
      id: `command-${String(version)}`,
      type: 'AddEntry',
      timestamp: Date.now(),
      ...(version === undefined ? {} : { version }),
      data: makeRemoteEntry(entryId),
    } as unknown as SyncCommand)

    await receiverCommandManager.processRemoteCommands()

    expect(receiverFavaLib.vault.getEntryMeta(entryId).name).toBe('Remote TOTP')
  })

  it('should drop, not misapply, a remote command from a newer protocol', async () => {
    // receiveCommands calls receiveRemoteCommand inside a Promise.all, so
    // throwing here would abort the whole batch. Dropping is also lossless:
    // the command is never reported as executed, so the server keeps it
    // queued and redelivers it once this device is upgraded.
    const entryId = 'version-too-new' as EntryId
    const receiverCommandManager = getReceiverCommandManager()
    const warnings: string[] = []
    receiverFavaLib.addEventListener(FavaLibEvent.Log, (event) => {
      if (event.detail.severity === 'warning')
        warnings.push(event.detail.message)
    })

    receiverCommandManager.receiveRemoteCommand({
      id: 'command-from-the-future',
      type: 'AddEntry',
      timestamp: Date.now(),
      version: '3.0',
      data: makeRemoteEntry(entryId),
    } as unknown as SyncCommand)

    const executedIds = await receiverCommandManager.processRemoteCommands()

    expect(executedIds).not.toContain('command-from-the-future')
    expect(() => receiverFavaLib.vault.getEntryMeta(entryId)).toThrow()
    expect(warnings.join('\n')).toMatch(/sync protocol version 3\.0/)
  })

  it('should warn only once about the same unsupported command', () => {
    // The server redelivers unexecuted commands on every reconnect, so
    // without deduplication this would warn forever.
    const receiverCommandManager = getReceiverCommandManager()
    const warnings: string[] = []
    receiverFavaLib.addEventListener(FavaLibEvent.Log, (event) => {
      if (event.detail.severity === 'warning')
        warnings.push(event.detail.message)
    })

    const command = {
      id: 'repeatedly-redelivered',
      type: 'AddEntry',
      timestamp: Date.now(),
      version: '3.0',
      data: makeRemoteEntry('version-repeat' as EntryId),
    } as unknown as SyncCommand

    receiverCommandManager.receiveRemoteCommand(command)
    receiverCommandManager.receiveRemoteCommand(command)
    receiverCommandManager.receiveRemoteCommand(command)

    expect(
      warnings.filter((w) => w.includes('repeatedly-redelivered')),
    ).toHaveLength(1)
  })

  it('should apply the rest of a batch when one command cannot be decrypted', async () => {
    // receiveCommands maps over the batch inside a Promise.all. Without a
    // per-command catch, one undecryptable command -- a peer still on the v1
    // envelope, a row the server has held since before the upgrade, or a
    // hostile one -- would reject the whole promise and take
    // processRemoteCommands and the ready event down with it.
    const warnings: string[] = []
    receiverFavaLib.addEventListener(FavaLibEvent.Log, (event) => {
      if (event.detail.severity === 'warning')
        warnings.push(event.detail.message)
    })

    const cryptoLib = new nodeProviders.CryptoLib()
    /**
     * Encrypts one command the way sendCommand does.
     * @param commandId - The id the command travels under.
     * @param entryId - The entry the command adds.
     * @returns The wire representation of the command.
     */
    const encryptCommandFor = async (commandId: string, entryId: EntryId) => {
      const commandKey = await cryptoLib.createSymmetricKey()
      return {
        commandId,
        encryptedSymmetricKey: await cryptoLib.encrypt(publicKey, commandKey),
        encryptedCommand: await cryptoLib.encryptSymmetric(
          commandKey,
          JSON.stringify({
            type: 'AddEntry',
            timestamp: Date.now(),
            version: '2.0',
            data: makeRemoteEntry(entryId),
          }),
          buildCommandAad(commandId, 'receiverDeviceId'),
        ),
      }
    }

    const good1 = await encryptCommandFor('batch-good-1', 'batch-1' as EntryId)
    const good2 = await encryptCommandFor('batch-good-2', 'batch-2' as EntryId)
    const intact = await encryptCommandFor('batch-bad', 'batch-bad' as EntryId)
    // Corrupt the middle one only.
    const badParts = intact.encryptedCommand.split(':')
    const badBytes = base64ToUint8Array(badParts[2])
    badBytes[0] ^= 0xff
    badParts[2] = uint8ArrayToBase64(badBytes)
    const bad = {
      ...intact,
      encryptedCommand: badParts.join(':') as typeof intact.encryptedCommand,
    }

    await expect(
      receiverFavaLib.sync!.receiveCommands([good1, bad, good2]),
    ).resolves.not.toThrow()

    expect(
      receiverFavaLib.vault.getEntryMeta('batch-1' as EntryId),
    ).toBeTruthy()
    expect(
      receiverFavaLib.vault.getEntryMeta('batch-2' as EntryId),
    ).toBeTruthy()
    expect(() =>
      receiverFavaLib.vault.getEntryMeta('batch-bad' as EntryId),
    ).toThrow()
    expect(warnings.filter((w) => w.includes('batch-bad'))).toHaveLength(1)
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
      macKey,
      kdf,
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

  describe('sync device validation', () => {
    // The single chokepoint every route a peer device arrives by has to pass:
    // importVaultState, AddSyncDeviceCommand, and the constructor's own
    // registration. See key-hierarchy-review/05-load-path-validation.md.
    //
    // A shape gate ONLY. A well formed record carrying an attacker's public key
    // still passes every one of these, because nothing authenticates the sender
    // of an AddSyncDeviceCommand -- that is 14-sync-device-injection.md, open.
    const goodDevice = () => ({
      deviceId: 'shape-check-peer' as DeviceId,
      publicKey,
      deviceInfo: { deviceType: 'test' as DeviceType },
    })

    it.each([
      ['no publicKey', { publicKey: undefined }],
      ['a publicKey that is not a PEM', { publicKey: 'not-a-pem' }],
      ['no deviceId', { deviceId: undefined }],
      ['a non-object deviceInfo', { deviceInfo: 'cli' }],
    ])('refuses to add a device with %s', async (_label, overrides) => {
      const before = receiverFavaLib.sync?.getSyncDevices().length

      await expect(
        receiverFavaLib.sync?.addSyncDevice({
          ...goodDevice(),
          ...overrides,
        } as unknown as SyncDevice),
      ).rejects.toThrow(/Refusing to add sync device/)

      expect(receiverFavaLib.sync?.getSyncDevices()).toHaveLength(before!)
    })

    it('adds a well-formed device', async () => {
      const before = receiverFavaLib.sync?.getSyncDevices().length ?? 0
      await receiverFavaLib.sync?.addSyncDevice(goodDevice(), false)
      expect(receiverFavaLib.sync?.getSyncDevices()).toHaveLength(before + 1)
    })

    it('refuses to go past the device cap', async () => {
      // Every outgoing command is encrypted once per device, so an unbounded
      // list is an unbounded amount of RSA work per keystroke.
      // The cap counts the STORED list, which includes this device's own
      // record; getSyncDevices filters that one out, so the peer count tops out
      // one lower. Both enforcement points count the stored list so that they
      // agree about the same vault.
      const sync = receiverFavaLib.sync!
      for (
        let i = 0;
        sync.getSyncDevices().length < MAX_SYNC_DEVICES - 1;
        i++
      ) {
        await sync.addSyncDevice(
          {
            ...goodDevice(),
            deviceId: `cap-peer-${i}` as DeviceId,
          },
          false,
        )
      }
      expect(sync.getSyncDevices()).toHaveLength(MAX_SYNC_DEVICES - 1)

      await expect(
        sync.addSyncDevice(
          {
            ...goodDevice(),
            deviceId: 'one-too-many' as DeviceId,
          },
          false,
        ),
      ).rejects.toThrow(new RegExp(`maximum of ${MAX_SYNC_DEVICES} devices`))
    })

    it('drops a malformed AddSyncDevice command without taking the batch down', async () => {
      // processRemoteCommands catches per command, so a hostile or broken peer
      // costs one command rather than the whole queue -- and the server
      // redelivers it, so nothing is lost if the peer was merely wrong.
      const receiverCommandManager = getReceiverCommandManager()
      const warnings: string[] = []
      receiverFavaLib.addEventListener(FavaLibEvent.Log, (event) => {
        if (event.detail.severity === 'warning')
          warnings.push(event.detail.message)
      })

      const goodEntryId = 'survives-the-bad-device' as EntryId
      receiverCommandManager.receiveRemoteCommand({
        id: 'bad-add-sync-device',
        type: 'AddSyncDevice',
        timestamp: Date.now(),
        version: '2.0',
        data: { deviceId: 'hostile-peer', deviceInfo: { deviceType: 'test' } },
      } as unknown as SyncCommand)
      receiverCommandManager.receiveRemoteCommand({
        id: 'good-add-entry',
        type: 'AddEntry',
        timestamp: Date.now(),
        version: '2.0',
        data: makeRemoteEntry(goodEntryId),
      } as unknown as SyncCommand)

      const executedIds = await receiverCommandManager.processRemoteCommands()

      expect(executedIds).not.toContain('bad-add-sync-device')
      expect(executedIds).toContain('good-add-entry')
      expect(receiverFavaLib.vault.getEntryMeta(goodEntryId).name).toBe(
        'Remote TOTP',
      )
      expect(
        receiverFavaLib.sync?.getSyncDevices().map((d) => d.deviceId),
      ).not.toContain('hostile-peer')
      expect(warnings.join('\n')).toMatch(/Invalid AddSyncDevice command/)
    })
  })

  describe('flushCommandSendQueue', () => {
    let wsInstancesMap: Map<DeviceId, WsClient>

    beforeEach(async () => {
      wsInstancesMap = new Map([
        [senderFavaLib.meta.deviceId, senderWsInstance],
        [receiverFavaLib.meta.deviceId, receiverWsInstance],
      ])
      await connectDevices({
        senderFavaLib,
        receiverFavaLib,
        server,
        wsInstancesMap,
      })
    })

    it('should resolve immediately when nothing is queued', async () => {
      await expect(senderFavaLib.sync?.flushCommandSendQueue()).resolves.toBe(
        true,
      )
    })

    it('should wait for the server to acknowledge a queued command', async () => {
      await senderFavaLib.vault.addEntry(newTotpEntry)
      expect(senderFavaLib.sync?.getCommandSendQueue()).toHaveLength(1)

      let settled = false
      const flushed = senderFavaLib.sync
        ?.flushCommandSendQueue()
        .then((result) => {
          settled = true
          return result
        })

      // the command is on the wire, but unacknowledged
      await vi.waitFor(() =>
        expect(server.messagesToConsume.pendingItems).not.toHaveLength(0),
      )
      expect(settled).toBe(false)

      await handleSyncCommands(
        server,
        senderFavaLib.meta.deviceId,
        wsInstancesMap,
      )

      await expect(flushed).resolves.toBe(true)
      expect(senderFavaLib.sync?.getCommandSendQueue()).toHaveLength(0)
    })

    it('should give up, keeping the command queued, when the server stays silent', async () => {
      await senderFavaLib.vault.addEntry(newTotpEntry)

      await expect(senderFavaLib.sync?.flushCommandSendQueue(50)).resolves.toBe(
        false,
      )
      expect(senderFavaLib.sync?.getCommandSendQueue()).toHaveLength(1)
    })

    it('should not wait when there is no connection to flush over', async () => {
      senderWsInstance.close()
      await vi.waitUntil(() => !senderFavaLib.sync?.webSocketConnected)

      await senderFavaLib.vault.addEntry(newTotpEntry)

      const before = Date.now()
      await expect(senderFavaLib.sync?.flushCommandSendQueue()).resolves.toBe(
        false,
      )
      expect(Date.now() - before).toBeLessThan(200)
      expect(senderFavaLib.sync?.getCommandSendQueue()).toHaveLength(1)
    })
  })

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
      macKey,
      kdf,
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
