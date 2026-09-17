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
  handleSyncCommands,
  password,
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
    void senderFavaLib.setSyncServerUrl(serverUrl)
    await server.connected
    await server.nextMessage // wait for the hello message

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
    // The nonce field every client message used to carry is gone: the client
    // generated one, the server never read it, and no client verified one
    // either. A field that looks like a security control and is read by nobody
    // is worse than no field -- key-hierarchy-review/15-sync-replay-protection.md.
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
    // key-hierarchy-review/13-sync-command-authentication.md. Sealing a command
    // to a device's public key proves nothing about who sealed it -- sealing is
    // a public operation -- so before these checks anyone holding a public key
    // could mint commands for that device. Every case below is a command that
    // decrypts perfectly and is refused anyway.
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
    // key-hierarchy-review/15-sync-replay-protection.md. The server re-sends
    // everything it has not been told was executed, so the same id arriving
    // twice is routine; what was missing is that the record of what had been
    // applied lived only in memory.
    beforeEach(async () => {
      await registerSenderAsPeer()
    })

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
      await restarted.sync!.receiveCommands([command])

      expect(() =>
        restarted.vault.getEntryMeta('replay-restarted' as EntryId),
      ).toThrow()
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
      await withFloor.sync!.receiveCommands([command])

      expect(() =>
        withFloor.vault.getEntryMeta('replay-below-floor' as EntryId),
      ).toThrow()
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
    // A shape gate ONLY. A well formed record carrying an attacker's public
    // keys still passes every one of these; what stops it reaching here is that
    // an AddSyncDeviceCommand must now be signed by a device already in the
    // peer list -- 14-sync-device-injection.md is still open for the rest.
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
