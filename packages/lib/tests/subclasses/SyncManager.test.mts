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
  AuthProofClientMessage,
  ConnectClientMessage,
  SyncCommandFromClient,
  SyncCommandsClientMessage,
  StartResilverClientMessage,
} from '../../src/interfaces/protocol/ClientMessage.mjs'
import {
  Encrypted,
  EncryptedSecretKeys,
  EncryptedSymmetricKey,
  Salt,
  MacKey,
  KdfParameters,
  FavaLib,
  DeviceType,
  PrivateKey,
  Signature,
  SigningSecretKey,
  SymmetricKey,
  PublicKey,
  SigningPublicKey,
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
import {
  buildCommandAad,
  buildCommandSignatureMessage,
} from '../../src/utils/canonical.mjs'
import { COMMAND_VERSION } from '../../src/version.mjs'
import type { SyncCommand } from '../../src/interfaces/CommandTypes.mjs'

import {
  anotherNewTotpEntry,
  createFavaLibForTests,
  newTotpEntry,
  totpEntry,
  send,
  connectDevices,
  completeHandshake,
  handleSyncCommands,
  password,
  testServerNonce,
  testServerSecret,
} from '../testUtils.mjs'
import { createConnectProof } from '../../src/utils/connectAuth.mjs'
import { ConnectionStatus } from '../../src/subclasses/SyncManager.mjs'
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
import {
  MAX_REMOVED_DEVICES,
  MAX_SYNC_DEVICES,
} from '../../src/utils/syncDeviceValidation.mjs'
import { FavaLibEvent } from '../../src/FavaLibEvent.mjs'
import type { VaultServerMessage } from '../../src/interfaces/protocol/ServerMessage.mjs'

const serverPort = 9770
const serverBaseUrl = 'ws://localhost'

describe('SyncManager', () => {
  let serverUrl: string
  let platformProviders: PlatformProviders
  let privateKey: PrivateKey
  let signingSecretKey: SigningSecretKey
  let symmetricKey: SymmetricKey
  let publicKey: PublicKey
  let signingPublicKey: SigningPublicKey
  let encryptedSecretKeys: EncryptedSecretKeys
  let encryptedSymmetricKey: EncryptedSymmetricKey
  let salt: Salt
  let macKey: MacKey
  let kdf: KdfParameters
  let server: WS
  let senderFavaLib: FavaLib
  let receiverFavaLib: FavaLib
  let senderWsInstance: WsClient
  let receiverWsInstance: WsClient
  let clients: WsClient[]

  /**
   * Waits for the nth client to connect to the mock server.
   * @param index - Zero-based position in connection order.
   * @returns That client.
   */
  const nthClient = async (index: number) => {
    await vi.waitUntil(() => clients.length > index, {
      timeout: 2000,
      interval: 10,
    })
    return clients[index]
  }

  beforeAll(async () => {
    const result = await createFavaLibForTests()
    platformProviders = result.platformProviders
    encryptedSecretKeys = result.encryptedSecretKeys
    encryptedSymmetricKey = result.encryptedSymmetricKey
    macKey = result.macKey
    kdf = result.kdf
    privateKey = result.privateKey
    signingSecretKey = result.signingSecretKey
    symmetricKey = result.symmetricKey
    publicKey = result.publicKey
    signingPublicKey = result.signingPublicKey
    salt = result.salt

    serverUrl = `${serverBaseUrl}:${serverPort}`
  })

  beforeEach(async () => {
    server = new WS(serverUrl, { jsonProtocol: true })
    clients = []
    // server.connected is broken, so we have to use this workaround
    const allConnected = new Promise<void>((resolve) => {
      server.on('connection', (client) => {
        // Every client, not just the first two: a reconnect opens a third, and
        // it has to be handed a challenge like any other.
        clients.push(client)
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
      { privateKey, signingSecretKey },
      symmetricKey,
      encryptedSecretKeys,
      encryptedSymmetricKey,
      salt,
      macKey,
      kdf,
      { publicKey, signingPublicKey },
      {
        deviceId: 'senderDeviceId' as DeviceId,
        deviceFriendlyName: 'senderFriendlyName' as DeviceFriendlyName,
      },
      [],
    )
    void senderFavaLib.setSyncServerUrl(serverUrl, testServerSecret)
    await server.connected
    await completeHandshake(server, senderWsInstance)

    await senderFavaLib.vault.addEntry(newTotpEntry)

    receiverFavaLib = new FavaLib(
      'receiver' as DeviceType,
      platformProviders,
      ['test'],
      { privateKey, signingSecretKey },
      symmetricKey,
      encryptedSecretKeys,
      encryptedSymmetricKey,
      salt,
      macKey,
      kdf,
      { publicKey, signingPublicKey },
      {
        deviceId: 'receiverDeviceId' as DeviceId,
        deviceFriendlyName: 'receiverFriendlyName' as DeviceFriendlyName,
      },
      [],
    )
    void receiverFavaLib.setSyncServerUrl(serverUrl, testServerSecret)
    await allConnected
    await completeHandshake(server, receiverWsInstance)
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
      { privateKey, signingSecretKey },
      symmetricKey,
      encryptedSecretKeys,
      encryptedSymmetricKey,
      salt,
      macKey,
      kdf,
      { publicKey, signingPublicKey },
      { deviceId: 'disconnectedDeviceId' as DeviceId },
      [],
      undefined,
      {
        serverUrl: temporaryServerUrl,
        serverSecret: testServerSecret,
        devices: [],
        commandSendQueue: [],
      },
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

    // wait for the import to finish -- an argon2id derivation on both sides,
    // so the same generous budget as connectDevices in testUtils.mts, and for
    // the reason spelled out there.
    await vi.waitUntil(() => !receiverFavaLib.sync?.inAddDeviceFlow, {
      timeout: 5000,
      interval: 5,
    })
    // The nonce field every client message used to carry is gone: the client
    // generated one and nobody read it. A field that looks like a security
    // control and is read by nobody is worse than no field.
    expect(
      messageDatas.some((d) => 'nonce' in (d as Record<string, unknown>)),
    ).toBe(false)

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
    // Both ends record the other as 'pairing', and both are acknowledged
    // without anyone being asked: the user was standing in front of both
    // devices holding the out-of-band secret. Only a peer INTRODUCING a third
    // device needs surfacing.
    expect(senderSyncDevices[0]).toEqual({
      deviceId: 'receiverDeviceId' as DeviceId,
      deviceFriendlyName: 'receiverFriendlyName' as DeviceFriendlyName,
      deviceType: 'receiver',
      fingerprint: expect.any(String) as string,
      enrolment: {
        via: 'pairing',
        by: undefined,
        at: expect.any(Number) as number,
      },
      acknowledged: true,
    })
    expect(receiverSyncDevices[0]).toEqual({
      deviceId: 'senderDeviceId' as DeviceId,
      deviceFriendlyName: 'senderFriendlyName' as DeviceFriendlyName,
      deviceType: 'sender',
      fingerprint: expect.any(String) as string,
      enrolment: {
        via: 'pairing',
        by: undefined,
        at: expect.any(Number) as number,
      },
      acknowledged: true,
    })
    // Six groups of four uppercase hex: 96 bits, short enough to read aloud
    // off one screen and check against another, which is the only thing a
    // fingerprint is for.
    for (const device of [senderSyncDevices[0], receiverSyncDevices[0]]) {
      expect(device.fingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){5}$/)
    }
    expect(senderSyncDevices[0].fingerprint).not.toBe(
      receiverSyncDevices[0].fingerprint,
    )
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

  /**
   * Puts the sending device in the receiver's peer list.
   *
   * Nothing below verifies without this, which is the finding in one line: a
   * command is only acted on if a device CURRENTLY in this vault's list signed
   * it. Both test libraries share one set of key material, so the sender's
   * signing key is the same value the receiver holds.
   * @returns A promise that resolves once the peer is known.
   */
  const registerSenderAsPeer = () =>
    receiverFavaLib.sync!.addSyncDevice(
      {
        deviceId: 'senderDeviceId' as DeviceId,
        publicKey,
        signingPublicKey,
        deviceInfo: { deviceType: 'sender' as DeviceType },
      },
      'pairing',
      undefined,
      false,
    )

  /**
   * Builds one command on the wire exactly as sendCommand does: signed by the
   * sending device, then sealed to the recipient.
   *
   * Kept as one helper rather than inlined per test, because the point of most
   * of the tests below is that ONE field of it is wrong.
   * @param commandId - The id the command travels under.
   * @param entryId - The entry the command adds.
   * @param overrides - What to do differently from a well formed command.
   * @param overrides.from - The device the command claims to be from.
   * @param overrides.signWith - The key it is actually signed with.
   * @param overrides.payloadCommandId - The id written inside the payload.
   * @param overrides.toDeviceId - The recipient bound into the signature.
   * @param overrides.omitSignature - Send no signature at all.
   * @returns The wire representation of the command.
   */
  const encryptCommandFor = async (
    commandId: string,
    entryId: EntryId,
    overrides: {
      from?: string
      signWith?: SigningSecretKey
      payloadCommandId?: string
      toDeviceId?: string
      omitSignature?: boolean
    } = {},
  ) => {
    const cryptoLib = new nodeProviders.CryptoLib()
    const from = overrides.from ?? 'senderDeviceId'
    const payload = JSON.stringify({
      id: overrides.payloadCommandId ?? commandId,
      type: 'AddEntry',
      timestamp: Date.now(),
      version: COMMAND_VERSION,
      data: makeRemoteEntry(entryId),
    })
    const signature = await cryptoLib.sign(
      overrides.signWith ?? signingSecretKey,
      buildCommandSignatureMessage(
        commandId,
        from,
        overrides.toDeviceId ?? 'receiverDeviceId',
        payload,
      ),
    )
    const commandKey = await cryptoLib.createSymmetricKey()
    return {
      commandId,
      encryptedSymmetricKey: await cryptoLib.encrypt(publicKey, commandKey),
      encryptedCommand: await cryptoLib.encryptSymmetric(
        commandKey,
        JSON.stringify(
          overrides.omitSignature ? { payload } : { from, signature, payload },
        ),
        buildCommandAad(commandId, 'receiverDeviceId'),
      ),
    }
  }

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

    await registerSenderAsPeer()

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

  describe('command authentication', () => {
    // Sealing is a public operation, so before these checks anyone holding a
    // device's public key could mint commands for it. Every case below decrypts
    // perfectly and is refused anyway.
    let warnings: string[]

    beforeEach(async () => {
      warnings = []
      receiverFavaLib.addEventListener(FavaLibEvent.Log, (event) => {
        if (event.detail.severity === 'warning')
          warnings.push(event.detail.message)
      })
      await registerSenderAsPeer()
    })

    /**
     * Delivers one command and says whether it was applied.
     * @param command - The command, from encryptCommandFor.
     * @param entryId - The entry it would add.
     * @returns Whether the entry exists afterwards.
     */
    const deliver = async (
      command: Awaited<ReturnType<typeof encryptCommandFor>>,
      entryId: EntryId,
    ) => {
      await receiverFavaLib.sync!.receiveCommands([command])
      try {
        return Boolean(receiverFavaLib.vault.getEntryMeta(entryId))
      } catch {
        return false
      }
    }

    it('applies a command signed by a known peer', async () => {
      // The control. Without it every refusal below could be passing for the
      // wrong reason.
      const command = await encryptCommandFor('auth-ok', 'auth-ok' as EntryId)
      expect(await deliver(command, 'auth-ok' as EntryId)).toBe(true)
    })

    it('drops a command with no signature at all', async () => {
      // The server relays the envelope untouched, so stripping the signature is
      // the first thing a hostile one would try.
      const command = await encryptCommandFor(
        'auth-unsigned',
        'auth-unsigned' as EntryId,
        { omitSignature: true },
      )
      expect(await deliver(command, 'auth-unsigned' as EntryId)).toBe(false)
    })

    it('drops a command whose signature does not verify', async () => {
      const cryptoLib = new nodeProviders.CryptoLib()
      const stranger = await cryptoLib.createKeys(password)
      const command = await encryptCommandFor(
        'auth-forged',
        'auth-forged' as EntryId,
        { signWith: stranger.signingSecretKey },
      )
      expect(await deliver(command, 'auth-forged' as EntryId)).toBe(false)
    })

    it('drops a command from a device that is not a peer', async () => {
      const command = await encryptCommandFor(
        'auth-stranger',
        'auth-stranger' as EntryId,
        { from: 'someone-elses-device' },
      )
      expect(await deliver(command, 'auth-stranger' as EntryId)).toBe(false)
    })

    it('drops a command from a peer that has been removed', async () => {
      // THE point of naming the signer. removeSyncDevice used to splice an
      // array and change nothing about what the removed device could still do;
      // now it is the revocation it always looked like.
      await receiverFavaLib.sync!.removeSyncDevice(
        'senderDeviceId' as DeviceId,
        false,
      )
      const command = await encryptCommandFor(
        'auth-revoked',
        'auth-revoked' as EntryId,
      )
      expect(await deliver(command, 'auth-revoked' as EntryId)).toBe(false)
    })

    it('drops a command whose payload id differs from its envelope id', async () => {
      // Only a device already in the peer list can reach this check -- an
      // outsider fails the signature first -- which is exactly why it exists:
      // a peer that signs for one command id and writes another inside the
      // payload makes the id the dedup set records differ from the id the
      // command is applied under.
      const command = await encryptCommandFor(
        'auth-id-envelope',
        'auth-id' as EntryId,
        { payloadCommandId: 'auth-id-payload' },
      )
      expect(await deliver(command, 'auth-id' as EntryId)).toBe(false)
    })

    it('drops a command signed for a different recipient', async () => {
      const command = await encryptCommandFor(
        'auth-recipient',
        'auth-recipient' as EntryId,
        { toDeviceId: 'some-other-device' },
      )
      expect(await deliver(command, 'auth-recipient' as EntryId)).toBe(false)
    })

    it('says nothing about which check failed', async () => {
      // Every refusal produces the same message. Telling a prober whether a
      // device id is known, or whether a signature merely did not verify, is
      // telling them something.
      const unsigned = await encryptCommandFor(
        'auth-quiet-1',
        'auth-quiet-1' as EntryId,
        { omitSignature: true },
      )
      const stranger = await encryptCommandFor(
        'auth-quiet-2',
        'auth-quiet-2' as EntryId,
        { from: 'someone-elses-device' },
      )
      await receiverFavaLib.sync!.receiveCommands([unsigned, stranger])

      const messages = warnings
        .filter((w) => w.includes('auth-quiet'))
        .map((w) => w.replace(/auth-quiet-\d/, 'ID'))
      expect(messages).toHaveLength(2)
      expect(new Set(messages).size).toBe(1)
    })
  })

  describe('replay protection', () => {
    // The server re-sends everything it has not been told was executed, so the
    // same id arriving twice is routine; what was missing is that the record of
    // what had been applied lived only in memory.
    beforeEach(async () => {
      await registerSenderAsPeer()
    })

    const captureAcknowledgments = (lib: FavaLib) => {
      const send = vi.fn<(type: string, data: unknown) => void>()
      // @ts-expect-error Capture acknowledgments from the offline test instance.
      lib.sync!.sendToServer = send
      return send
    }

    it('applies a redelivered command only once', async () => {
      const command = await encryptCommandFor(
        'replay-once',
        'replay-once' as EntryId,
      )
      await receiverFavaLib.sync!.receiveCommands([command])
      const before = receiverFavaLib.vault.size

      await receiverFavaLib.sync!.receiveCommands([command])
      expect(receiverFavaLib.vault.size).toBe(before)
    })

    it('records what it applied, so the record can be persisted', async () => {
      const command = await encryptCommandFor(
        'replay-recorded',
        'replay-recorded' as EntryId,
      )
      await receiverFavaLib.sync!.receiveCommands([command])

      expect(receiverFavaLib.sync!.getProcessedCommands()?.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'replay-recorded',
            from: 'senderDeviceId',
          }),
        ]),
      )
    })

    it('refuses a command it applied before a restart', async () => {
      // A restart used to empty the dedup set, and the server redelivers on
      // every reconnect, so this is the case the in-memory set never covered.
      const restarted = new FavaLib(
        'restarted' as DeviceType,
        platformProviders,
        ['test'],
        { privateKey, signingSecretKey },
        symmetricKey,
        encryptedSecretKeys,
        encryptedSymmetricKey,
        salt,
        macKey,
        kdf,
        { publicKey, signingPublicKey },
        { deviceId: 'receiverDeviceId' as DeviceId },
        [],
        undefined,
        {
          serverUrl,
          serverSecret: testServerSecret,
          devices: [
            {
              deviceId: 'senderDeviceId' as DeviceId,
              publicKey,
              signingPublicKey,
              deviceInfo: { deviceType: 'sender' as DeviceType },
            },
          ],
          commandSendQueue: [],
          processedCommands: {
            commands: [
              {
                id: 'replay-restarted',
                from: 'senderDeviceId' as DeviceId,
                timestamp: Date.now(),
              },
            ],
            floors: {},
          },
        },
        false,
      )

      const command = await encryptCommandFor(
        'replay-restarted',
        'replay-restarted' as EntryId,
      )
      const acknowledge = captureAcknowledgments(restarted)
      await restarted.sync!.receiveCommands([command])

      expect(() =>
        restarted.vault.getEntryMeta('replay-restarted' as EntryId),
      ).toThrow()
      expect(acknowledge).toHaveBeenCalledWith('syncCommandsExecuted', {
        commandIds: ['replay-restarted'],
      })
      restarted.sync?.closeServerConnection()
    })

    it("refuses a command older than its sender's floor", async () => {
      // The record is bounded, so forgetting an id must not make it acceptable
      // again: pruning raises the sender's floor, and anything at or below it
      // is refused without needing to remember why.
      const withFloor = new FavaLib(
        'floored' as DeviceType,
        platformProviders,
        ['test'],
        { privateKey, signingSecretKey },
        symmetricKey,
        encryptedSecretKeys,
        encryptedSymmetricKey,
        salt,
        macKey,
        kdf,
        { publicKey, signingPublicKey },
        { deviceId: 'receiverDeviceId' as DeviceId },
        [],
        undefined,
        {
          serverUrl,
          serverSecret: testServerSecret,
          devices: [
            {
              deviceId: 'senderDeviceId' as DeviceId,
              publicKey,
              signingPublicKey,
              deviceInfo: { deviceType: 'sender' as DeviceType },
            },
          ],
          commandSendQueue: [],
          processedCommands: {
            commands: [],
            floors: { ['senderDeviceId' as DeviceId]: Date.now() + 60_000 },
          },
        },
        false,
      )

      const command = await encryptCommandFor(
        'replay-below-floor',
        'replay-below-floor' as EntryId,
      )
      const acknowledge = captureAcknowledgments(withFloor)
      await withFloor.sync!.receiveCommands([command])

      expect(() =>
        withFloor.vault.getEntryMeta('replay-below-floor' as EntryId),
      ).toThrow()
      expect(acknowledge).toHaveBeenCalledWith('syncCommandsExecuted', {
        commandIds: ['replay-below-floor'],
      })
      withFloor.sync?.closeServerConnection()
    })
  })

  it('should emit ready event after receiving syncCommands message', async () => {
    const readyPromise = new Promise<void>((resolve) => {
      senderFavaLib.addEventListener(FavaLibEvent.Ready, () => resolve())
    })

    const newFavaLib = new FavaLib(
      'newSender' as DeviceType,
      platformProviders,
      ['test'],
      { privateKey, signingSecretKey },
      symmetricKey,
      encryptedSecretKeys,
      encryptedSymmetricKey,
      salt,
      macKey,
      kdf,
      { publicKey, signingPublicKey },
      { deviceId: 'newSenderDeviceId' as DeviceId },
      [],
      undefined,
      {
        serverUrl,
        serverSecret: testServerSecret,
        devices: [],
        commandSendQueue: [],
      },
    )

    // A third client, which has to get through the gate like the other two
    // before it will say `connect`.
    await completeHandshake(server, await nthClient(2))

    // Ready is asserted on senderFavaLib, so it is senderFavaLib that has to
    // receive the syncCommands message.
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
    expect(server.messagesToConsume.pendingItems).toHaveLength(0)

    // The client reconnects on its own, and the new socket has to prove the
    // shared secret again -- a socket's standing does not outlive the socket.
    // Nothing is re-sent before the server accepts it, which is the point of
    // moving processCommandSendQueue behind the handshake.
    senderWsInstance = await nthClient(2)
    wsInstancesMap.set(senderFavaLib.meta.deviceId, senderWsInstance)

    const connectMessage = await completeHandshake(server, senderWsInstance)
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

  describe('the sync server connection gate', () => {
    // An open socket is no longer a usable one: the server speaks first, and
    // nothing this device has to say happens until its proof of the shared
    // secret is accepted.
    const gateSyncState = (commandSendQueue: SyncCommandFromClient[] = []) => ({
      serverUrl,
      serverSecret: testServerSecret,
      devices: [],
      commandSendQueue,
    })

    const makeGatedLib = (
      deviceId: string,
      commandSendQueue?: SyncCommandFromClient[],
    ) =>
      new FavaLib(
        'gated' as DeviceType,
        platformProviders,
        ['test'],
        { privateKey, signingSecretKey },
        symmetricKey,
        encryptedSecretKeys,
        encryptedSymmetricKey,
        salt,
        macKey,
        kdf,
        { publicKey, signingPublicKey },
        { deviceId: deviceId as DeviceId },
        [],
        undefined,
        gateSyncState(commandSendQueue),
      )

    it('proves the secret without ever sending it', async () => {
      const lib = makeGatedLib('gate-proof')
      const client = await nthClient(2)

      send(client, 'authChallenge', { nonce: testServerNonce })
      const proof = (await server.nextMessage) as AuthProofClientMessage

      expect(proof.type).toBe('authProof')
      expect(proof.data.proof).toBe(
        createConnectProof(testServerSecret, testServerNonce),
      )
      // The thing itself stays on the device. A plain ws:// link in development
      // would otherwise hand it to anyone watching.
      expect(JSON.stringify(proof)).not.toContain(testServerSecret)

      lib.sync?.closeServerConnection()
    })

    it('does not report itself connected until the proof is accepted', async () => {
      const statuses: ConnectionStatus[] = []
      const lib = makeGatedLib('gate-status')
      lib.addEventListener(
        FavaLibEvent.ConnectionToSyncServerStatusChanged,
        (event) => {
          statuses.push(event.detail.newStatus)
        },
      )

      const client = await nthClient(2)
      send(client, 'authChallenge', { nonce: testServerNonce })
      await server.nextMessage // the proof

      expect(statuses).not.toContain(ConnectionStatus.CONNECTED)

      send(client, 'authAccepted', {})
      const connectMessage = (await server.nextMessage) as ConnectClientMessage
      expect(connectMessage.type).toBe('connect')

      await vi.waitUntil(() => statuses.includes(ConnectionStatus.CONNECTED), {
        timeout: 1000,
        interval: 10,
      })

      lib.sync?.closeServerConnection()
    })

    it('does not flush the send queue until the proof is accepted', async () => {
      const queued: SyncCommandFromClient = {
        commandId: 'queued-before-the-gate',
        deviceId: 'some-peer' as DeviceId,
        encryptedCommand: 'v2:AAAA:AAAA:AAAA' as Encrypted<string>,
        encryptedSymmetricKey: 'v2:AAAA:AAAA:AAAA' as EncryptedSymmetricKey,
      }
      const lib = makeGatedLib('gate-queue', [queued])

      const client = await nthClient(2)
      send(client, 'authChallenge', { nonce: testServerNonce })
      const proof = (await server.nextMessage) as AuthProofClientMessage
      expect(proof.type).toBe('authProof')

      // Nothing else has been said yet -- an unproven socket that could still
      // push its queue would be handing commands to a server that has not let
      // it in.
      expect(server.messagesToConsume.pendingItems).toHaveLength(0)

      send(client, 'authAccepted', {})
      await server.nextMessage // the connect message

      const flushed = (await server.nextMessage) as SyncCommandsClientMessage
      expect(flushed.type).toBe('syncCommands')
      expect(flushed.data.commands[0].commandId).toBe(queued.commandId)

      lib.sync?.closeServerConnection()
    })

    it('stops reconnecting when the server refuses the connection', async () => {
      const statuses: ConnectionStatus[] = []
      const lib = makeGatedLib('gate-refused')
      lib.addEventListener(
        FavaLibEvent.ConnectionToSyncServerStatusChanged,
        (event) => {
          statuses.push(event.detail.newStatus)
        },
      )

      const client = await nthClient(2)
      const clientsBefore = clients.length

      // 4401 is the server's one refusal, whatever the cause. A wrong secret
      // does not fix itself, so retrying every five seconds would only bury the
      // message that says what is wrong.
      client.close({ code: 4401, reason: 'Unauthorized', wasClean: true })

      await vi.waitUntil(() => statuses.includes(ConnectionStatus.FAILED), {
        timeout: 1000,
        interval: 10,
      })

      // Well past the 100ms reconnect interval tests run with.
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(clients).toHaveLength(clientsBefore)

      lib.sync?.closeServerConnection()
    })
  })

  describe('sync device validation', () => {
    // The single chokepoint every route a peer device arrives by has to pass:
    // importVaultState, AddSyncDeviceCommand, and the constructor's own
    // registration.
    //
    // These are the shape gate ONLY. A well formed record carrying an
    // attacker's public keys passes every one; the signature check and the
    // gates below it decide whether one gets this far.
    const goodDevice = () => ({
      deviceId: 'shape-check-peer' as DeviceId,
      publicKey,
      signingPublicKey,
      deviceInfo: { deviceType: 'test' as DeviceType },
    })

    it.each([
      ['no publicKey', { publicKey: undefined }],
      ['a publicKey that is not base64', { publicKey: '!'.repeat(44) }],
      ['a publicKey of the wrong length', { publicKey: 'AAAA' }],
      ['no signingPublicKey', { signingPublicKey: undefined }],
      ['a signingPublicKey of the wrong length', { signingPublicKey: 'AAAA' }],
      ['no deviceId', { deviceId: undefined }],
      ['a non-object deviceInfo', { deviceInfo: 'cli' }],
    ])('refuses to add a device with %s', async (_label, overrides) => {
      const before = receiverFavaLib.sync?.getSyncDevices().length

      await expect(
        receiverFavaLib.sync?.addSyncDevice(
          {
            ...goodDevice(),
            ...overrides,
          } as unknown as SyncDevice,
          'pairing',
        ),
      ).rejects.toThrow(/Refusing to add sync device/)

      expect(receiverFavaLib.sync?.getSyncDevices()).toHaveLength(before!)
    })

    it('adds a well-formed device', async () => {
      const before = receiverFavaLib.sync?.getSyncDevices().length ?? 0
      await receiverFavaLib.sync?.addSyncDevice(
        goodDevice(),
        'pairing',
        undefined,
        false,
      )
      expect(receiverFavaLib.sync?.getSyncDevices()).toHaveLength(before + 1)
    })

    it('refuses to go past the device cap', async () => {
      // Every outgoing command is sealed and signed once per device, so an
      // unbounded list is an unbounded amount of work per keystroke.
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
          'pairing',
          undefined,
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
          'pairing',
          undefined,
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

  describe('device enrolment and removal', () => {
    const peer = () => ({
      deviceId: 'enrolment-peer' as DeviceId,
      publicKey,
      signingPublicKey,
      deviceInfo: { deviceType: 'test' as DeviceType },
    })

    const sync = () => receiverFavaLib.sync!

    const has = (deviceId: string) =>
      sync()
        .getSyncDevices()
        .some((device) => device.deviceId === deviceId)

    it('remembers a removal, and refuses to let a peer undo it', async () => {
      await sync().addSyncDevice(peer(), 'pairing', undefined, false)
      await sync().removeSyncDevice(peer().deviceId, false)
      expect(has(peer().deviceId)).toBe(false)

      await expect(
        sync().addSyncDevice(peer(), 'peer', 'alice' as DeviceId, false),
      ).rejects.toThrow(/was removed from this vault/)
      expect(has(peer().deviceId)).toBe(false)
    })

    it('lets pairing with a removed device again bring it back', async () => {
      // A tombstone blocks introduction, never pairing: re-pairing costs the
      // 60-byte out-of-band secret and a user standing in front of both
      // devices, which is exactly the act being protected. Without this,
      // "I removed it by mistake" would be unrecoverable.
      await sync().addSyncDevice(peer(), 'pairing', undefined, false)
      await sync().removeSyncDevice(peer().deviceId, false)
      await sync().addSyncDevice(peer(), 'pairing', undefined, false)
      expect(has(peer().deviceId)).toBe(true)

      // And the tombstone is gone, not merely bypassed -- a device that is
      // both listed and tombstoned is a contradiction the load path refuses.
      expect(sync().getRemovedDevices()).toEqual({})
    })

    it('refuses to remove this device from its own vault', async () => {
      // FavaLib.removeSyncDevice refuses this too, but covers only the local
      // route; a peer's RemoveSyncDeviceCommand arrives here directly. This
      // device's own record is what a NEWLY PAIRED device learns its keys
      // from, so losing it presents much later as "pairing is broken".
      await expect(
        sync().removeSyncDevice(receiverFavaLib.meta.deviceId, false),
      ).rejects.toThrow(/Cannot remove the current device/)
    })

    it('does not tombstone a device it never held', async () => {
      // Otherwise a peer could inflate the bounded record with removals for
      // ids this vault never had, and push real tombstones out of it.
      await sync().removeSyncDevice('never-here' as DeviceId, false)
      expect(sync().getRemovedDevices()).toEqual({})
    })

    it('is idempotent for a device it already holds', async () => {
      // Every resilver replays the whole device list, so this is the common
      // case rather than an edge one.
      await sync().addSyncDevice(peer(), 'pairing', undefined, false)
      const before = sync().getSyncDevices().length
      await sync().addSyncDevice(peer(), 'peer', 'alice' as DeviceId, false)
      expect(sync().getSyncDevices()).toHaveLength(before)
    })

    it('pins keys on first receipt and refuses a contradicting record', async () => {
      await sync().addSyncDevice(peer(), 'pairing', undefined, false)
      const pinned = sync()
        .getSyncDevices()
        .find((device) => device.deviceId === peer().deviceId)!.fingerprint

      await expect(
        sync().addSyncDevice(
          { ...peer(), publicKey: ('B'.repeat(43) + '=') as PublicKey },
          'peer',
          'alice' as DeviceId,
          false,
        ),
      ).rejects.toThrow(/contradicts the keys this vault already holds/)

      expect(
        sync()
          .getSyncDevices()
          .find((device) => device.deviceId === peer().deviceId)!.fingerprint,
      ).toBe(pinned)
    })

    it('announces every change it makes to the device list', async () => {
      // A consumer listing devices re-reads getSyncDevices on Changed and on
      // nothing else, so without these the list only catches up when
      // something unrelated changes an entry: a device enrolled by a peer, or
      // renamed, or removed, stays invisible or stays listed.
      const changed = vi.fn()
      receiverFavaLib.addEventListener(FavaLibEvent.Changed, changed)

      await sync().addSyncDevice(peer(), 'peer', 'alice' as DeviceId, false)
      expect(changed).toHaveBeenCalledTimes(1)

      await sync().acknowledgeSyncDevice(peer().deviceId, false)
      expect(changed).toHaveBeenCalledTimes(2)

      sync().setDeviceInfo(peer().deviceId, {
        deviceType: 'test' as DeviceType,
        deviceFriendlyName: 'the phone' as DeviceFriendlyName,
      })
      expect(changed).toHaveBeenCalledTimes(3)

      await sync().removeSyncDevice(peer().deviceId, false)
      expect(changed).toHaveBeenCalledTimes(4)
    })

    it('stays quiet when nothing about the list changed', async () => {
      await sync().addSyncDevice(peer(), 'pairing', undefined, false)
      const changed = vi.fn()
      receiverFavaLib.addEventListener(FavaLibEvent.Changed, changed)

      // Every resilver replays the whole device list, and a device enrolled
      // by pairing is acknowledged already, so both of these are the common
      // case rather than an edge one.
      await sync().addSyncDevice(peer(), 'peer', 'alice' as DeviceId, false)
      await sync().acknowledgeSyncDevice(peer().deviceId, false)
      expect(
        sync().setDeviceInfo('never-here' as DeviceId, {
          deviceType: 'test' as DeviceType,
        }),
      ).toBe(false)
      await sync().removeSyncDevice('never-here' as DeviceId, false)

      expect(changed).not.toHaveBeenCalled()
    })

    it('forgets the oldest removals once past the cap, and says so', async () => {
      // Pruning here WEAKENS the record, which is why it is loud: a forgotten
      // tombstone is a device a peer may introduce again. There is no
      // equivalent of the replay floors to fall back on.
      const warnings: string[] = []
      receiverFavaLib.addEventListener(FavaLibEvent.Log, (event) => {
        if (event.detail.severity === 'warning') {
          warnings.push(event.detail.message)
        }
      })

      for (let i = 0; i <= MAX_REMOVED_DEVICES; i++) {
        const device = { ...peer(), deviceId: `gone-${i}` as DeviceId }
        await sync().addSyncDevice(device, 'pairing', undefined, false)
        await sync().removeSyncDevice(device.deviceId, false)
      }

      const removed = sync().getRemovedDevices()!
      expect(Object.keys(removed)).toHaveLength(MAX_REMOVED_DEVICES)
      expect(removed).not.toHaveProperty('gone-0')
      expect(warnings.join('\n')).toMatch(/Forgetting that sync device gone-0/)
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
      { privateKey, signingSecretKey },
      symmetricKey,
      encryptedSecretKeys,
      encryptedSymmetricKey,
      salt,
      macKey,
      kdf,
      { publicKey, signingPublicKey },
      { deviceId: 'otherReceiverDeviceId' as DeviceId },
      [],
      undefined,
      {
        serverUrl,
        serverSecret: testServerSecret,
        devices: [],
        commandSendQueue: [],
      },
    )

    await connectionPromise

    // The third device gets through the gate like the other two.
    await completeHandshake(server, otherReceiverWsInstance!)

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

    receiverFavaLib.sync!.requestResilver()
    const startResilverMessage =
      (await server.nextMessage) as StartResilverClientMessage
    expect(startResilverMessage).toEqual({
      type: 'startResilver',
      data: {
        deviceIds: expect.arrayContaining([
          senderFavaLib.meta.deviceId,
          receiverFavaLib.meta.deviceId,
        ]) as string[],
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
  it('refuses resilvered vault data that is not signed by the peer it claims', async () => {
    // A resilver carries the WHOLE vault and is sealed to this device's public
    // key, which anyone can do. `fromDeviceId` is stamped by the server, so on
    // its own it is a claim; the signature is what makes it testable.
    const warnings: string[] = []
    receiverFavaLib.addEventListener(FavaLibEvent.Log, (event) => {
      warnings.push(event.detail.message)
    })
    await registerSenderAsPeer()
    receiverFavaLib.sync!.requestResilver()

    const vaultMessage: VaultServerMessage = {
      type: 'vault',
      data: {
        forDeviceId: 'receiverDeviceId' as DeviceId,
        encryptedVaultData: 'v2:AAAA:AAAA' as EncryptedVaultStateString,
        encryptedSymmetricKey: 'v2:AAAA:AAAA:AAAA' as EncryptedSymmetricKey,
        signature: 'not-a-signature' as Signature,
        fromDeviceId: 'senderDeviceId' as DeviceId,
      },
    }

    // eslint-disable-next-line @typescript-eslint/dot-notation
    receiverFavaLib.sync!['handleServerMessage'](vaultMessage)

    await vi.waitUntil(
      () => warnings.some((w) => w.includes('signature does not verify')),
      { timeout: 500, interval: 10 },
    )
  })

  it('refuses resilvered vault data from a device that is not a peer', async () => {
    const warnings: string[] = []
    receiverFavaLib.addEventListener(FavaLibEvent.Log, (event) => {
      warnings.push(event.detail.message)
    })
    receiverFavaLib.sync!.requestResilver()

    const vaultMessage: VaultServerMessage = {
      type: 'vault',
      data: {
        forDeviceId: 'receiverDeviceId' as DeviceId,
        encryptedVaultData: 'v2:AAAA:AAAA' as EncryptedVaultStateString,
        encryptedSymmetricKey: 'v2:AAAA:AAAA:AAAA' as EncryptedSymmetricKey,
        signature: 'not-a-signature' as Signature,
        fromDeviceId: 'a-device-we-have-never-met' as DeviceId,
      },
    }

    // eslint-disable-next-line @typescript-eslint/dot-notation
    receiverFavaLib.sync!['handleServerMessage'](vaultMessage)

    await vi.waitUntil(() => warnings.some((w) => w.includes('not a peer')), {
      timeout: 500,
      interval: 10,
    })
  })

  it('should error when vault data is received but no sync request was made', () => {
    const vaultMessage: VaultServerMessage = {
      type: 'vault',
      data: {
        forDeviceId: 'receiverDeviceId' as DeviceId,
        encryptedVaultData: '' as EncryptedVaultStateString,
        encryptedSymmetricKey: '' as EncryptedSymmetricKey,
        signature: '' as Signature,
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
        encryptedVaultData: '' as EncryptedVaultStateString,
        encryptedSymmetricKey: '' as EncryptedSymmetricKey,
        signature: '' as Signature,
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
