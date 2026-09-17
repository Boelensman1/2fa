import {
  base64ToUint8Array,
  hexToUint8Array,
  stringToBase64,
  uint8ArrayToBase64,
  uint8ArrayToHex,
} from 'uint8array-extras'
import {
  deriveSFromPassword,
  JPakeThreePass,
  Pass2Result,
  Pass3Result,
} from 'jpake-ts'
import type ServerMessage from '../interfaces/protocol/ServerMessage.mjs'
import type ClientMessage from '../interfaces/protocol/ClientMessage.mjs'

import { FavaLibEvent } from '../FavaLibEvent.mjs'
import {
  ActiveAddDeviceFlow,
  InitiateAddDeviceFlowResult,
  SyncDevice,
  PublicSyncDevice,
  DeviceType,
  DeviceId,
  DeviceInfo,
  VaultStateSend,
} from '../interfaces/SyncTypes.mjs'
import { decodeInitiatorData, jsonToUint8Array } from '../utils/syncUtils.mjs'
import {
  buildCommandAad,
  buildCommandSignatureMessage,
  buildHandshakeAad,
  buildVaultDataAad,
  buildVaultDataSignatureMessage,
} from '../utils/canonical.mjs'
import { validateEntryFatal } from '../utils/entryValidation.mjs'
import {
  MAX_SYNC_DEVICES,
  parseDevicePublicKeys,
  validateSyncDevice,
} from '../utils/syncDeviceValidation.mjs'
import type {
  DevicePublicKeys,
  DeviceSecretKeys,
  Encrypted,
  EncryptedPublicKeys,
  PublicKeysString,
  Salt,
  Signature,
  SigningPublicKey,
  SymmetricKey,
} from '../interfaces/CryptoLib.mjs'
import type {
  SignedCommandEnvelope,
  SyncCommand,
} from '../interfaces/CommandTypes.mjs'
import type Command from '../Command/BaseCommand.mjs'

import type FavaLibMediator from '../FavaLibMediator.mjs'

import {
  InitializationError,
  SyncAddDeviceFlowConflictError,
  SyncError,
  SyncInWrongStateError,
  SyncNoServerConnectionError,
  SyncPairingVersionError,
  FavaLibError,
} from '../FavaLibError.mjs'
import { PAIRING_VERSION } from '../version.mjs'
import {
  EncryptedVaultStateString,
  ProcessedCommand,
  VaultSyncState,
  VaultSyncStateWithServerUrl,
} from '../interfaces/Vault.mjs'
import type { FavaMeta } from '../interfaces/FavaMeta.mjs'

import type { SyncCommandFromServer } from '../interfaces/protocol/ServerMessage.mjs'
import type { SyncCommandFromClient } from '../interfaces/protocol/ClientMessage.mjs'
import AddSyncDeviceCommand from '../Command/commands/AddSyncDeviceCommand.mjs'

const currentPairingMajorVersion = Number.parseInt(
  PAIRING_VERSION.split('.')[0],
  10,
)

/**
 * Checks that an initiator's pairing payload came from a build this one can
 * actually complete a JPAKE exchange with.
 *
 * The major versions must match exactly, in both directions -- see
 * PAIRING_VERSION for why there is no "older is fine" case here. A payload with
 * no version at all predates the field and so counts as major 1; one whose
 * version does not parse is refused rather than guessed at.
 * @param pairingVersion - The version claimed by the initiator's payload.
 * @throws {SyncPairingVersionError} If the two devices cannot pair.
 */
const assertPairingVersionIsSupported = (pairingVersion?: string) => {
  const major = Number.parseInt((pairingVersion ?? '1.0').split('.')[0], 10)
  if (major === currentPairingMajorVersion) {
    return
  }
  const described = pairingVersion
    ? `uses pairing version ${pairingVersion}`
    : 'predates pairing versions'
  const behind =
    Number.isNaN(major) || major < currentPairingMajorVersion
      ? 'the other device'
      : 'this device'
  throw new SyncPairingVersionError(
    `Cannot pair: the pairing code ${described}, and this device speaks ` +
      `pairing version ${PAIRING_VERSION}. The key exchange is not compatible ` +
      `across these versions -- update ${behind} and try again.`,
  )
}

const IN_TESTING = process.env.NODE_ENV === 'test'
const IN_DEV = process.env.NODE_ENV === 'development'

export enum ConnectionStatus {
  CONNECTING,
  CONNECTED,
  NOT_CONNECTED,
  FAILED,
}

/** How long `flushCommandSendQueue` waits for the server to acknowledge. */
const COMMAND_FLUSH_TIMEOUT = IN_TESTING ? 500 : 10_000

/**
 * How long an applied command's id is remembered, in milliseconds.
 *
 * Thirty days is chosen against how long a peer can plausibly be offline with
 * commands still queued for delivery, not against how long an attacker might
 * wait: an attacker's replay is refused by the floor once the id is pruned, so
 * this number trades vault size against how gracefully a long-absent device
 * comes back, and nothing else.
 */
const REPLAY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The most applied-command ids a vault keeps.
 *
 * A hard second bound under the age one, so a burst of traffic cannot grow the
 * stored vault without limit. At roughly 90 bytes an entry this is well under
 * 100 KiB.
 */
const MAX_PROCESSED_COMMANDS = 1000

/**
 * How many verified-but-not-yet-applied command origins are held in memory.
 *
 * An origin is normally removed a moment later, when `processRemoteCommands`
 * reports what ran. One whose command threw during execution is never reported,
 * so without a bound the map would keep an entry per failing command for the
 * life of the process. Oldest out first, and losing one costs only the
 * persisted dedup entry for a command that did not apply.
 */
const MAX_PENDING_COMMAND_ORIGINS = 1000

const generateNonCryptographicRandomString = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const length = Math.floor(Math.random() * 64) + 1
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join('')
}

/**
 * Manages synchronization of 2FA devices and communication with the server.
 */
class SyncManager {
  private ws?: WebSocket
  private activeAddDeviceFlow?: ActiveAddDeviceFlow
  private readonly reconnectInterval: number = IN_TESTING ? 100 : 5000 // 5 seconds
  readonly serverUrl: string
  private syncDevices: SyncDevice[]

  private readyEventEmitted = false

  private commandSendQueue: SyncCommandFromClient[] = []
  private commandSendQueueDrainedResolvers: (() => void)[] = []

  private reconnectTimeout?: NodeJS.Timeout
  private terminateTimeout?: NodeJS.Timeout
  private connectionFailedTimeout?: NodeJS.Timeout
  private shouldReconnect = true

  private requestedResilver = false
  private requestedResilverTimeout?: NodeJS.Timeout

  /**
   * Remote commands this device has applied, as persisted in the vault.
   *
   * The in-memory set CommandManager keeps is still there and still gates
   * `execute`, but it empties on every restart, and the server re-sends
   * everything it has not been told was executed. This is the half that
   * survives (key-hierarchy-review/15-sync-replay-protection.md).
   */
  private processedCommands: ProcessedCommand[]

  /**
   * Per peer, the newest timestamp whose command id has been pruned from
   * `processedCommands`. Anything at or below it is refused.
   */
  private replayFloors: Record<DeviceId, number>

  /**
   * Where a verified command came from, between verification and execution.
   *
   * In memory only, and deliberately: it exists for the few milliseconds
   * between `receiveCommands` verifying a command and `processRemoteCommands`
   * reporting whether it ran, because only commands that actually ran are worth
   * recording.
   */
  private pendingCommandOrigins = new Map<
    string,
    { from: DeviceId; timestamp: number }
  >()

  private get deviceId() {
    return this.favaMeta.deviceId
  }

  private get deviceInfo(): DeviceInfo {
    return {
      deviceType: this.deviceType,
      deviceFriendlyName: this.favaMeta.deviceFriendlyName,
    }
  }

  /**
   * Public getter for the command send queue.
   * @returns The command send queue.
   */
  public getCommandSendQueue() {
    return this.commandSendQueue
  }

  /**
   * Public getter for the replay-protection state, for persistence.
   * @returns The applied-command record and the per-peer floors.
   */
  public getProcessedCommands(): VaultSyncState['processedCommands'] {
    return { commands: this.processedCommands, floors: this.replayFloors }
  }

  /**
   * Public getter for the sync devices
   * @returns The sync devices (without their public key)
   */
  public getSyncDevices(): PublicSyncDevice[] {
    return this.syncDevices
      .filter((d) => d.deviceId !== this.deviceId)
      .map((d) => ({
        deviceId: d.deviceId,
        ...d.deviceInfo,
      }))
  }

  /**
   * Creates an instance of SyncManager.
   * @param mediator - The mediator for accessing other components.
   * @param publicKeys - This device's two public keys.
   * @param secretKeys - This device's two secret keys.
   * @param favaMeta - Meta info containing at least a unique identifier for this device.
   * @param syncState - The state of the sync.
   * @param deviceType - The identifier for this device type (e.g. 2fa-cli).
   * @param connectionEnabled - Whether to connect to the sync server during initialization.
   * @throws {InitializationError} If initialization fails (e.g., if the server URL is invalid).
   */
  constructor(
    private readonly mediator: FavaLibMediator,
    private readonly publicKeys: DevicePublicKeys,
    private readonly secretKeys: DeviceSecretKeys,
    private readonly favaMeta: FavaMeta,
    syncState: VaultSyncStateWithServerUrl,
    private readonly deviceType: DeviceType,
    private connectionEnabled = true,
  ) {
    const { serverUrl, devices, commandSendQueue, processedCommands } =
      syncState

    if (!serverUrl.startsWith('wss://')) {
      if (!serverUrl.startsWith('ws://') && !(IN_DEV || IN_TESTING)) {
        throw new InitializationError(
          'Invalid server URL, protocol must be wss',
        )
      }
    }
    this.syncDevices = devices
    this.commandSendQueue = commandSendQueue
    this.processedCommands = processedCommands?.commands ?? []
    this.replayFloors = processedCommands?.floors ?? {}
    this.serverUrl = serverUrl
    if (this.connectionEnabled) {
      this.initServerConnection()
    } else {
      this.readyEventEmitted = true
      setTimeout(() => this.dispatchLibEvent(FavaLibEvent.Ready), 1)
    }

    // add ourselves to the list of syncdevices if we're missing
    void this.addSyncDevice(
      {
        deviceId: this.favaMeta.deviceId,
        publicKey: this.publicKeys.publicKey,
        signingPublicKey: this.publicKeys.signingPublicKey,
        deviceInfo: this.deviceInfo,
      },
      false,
    )

    // if not yet connected after 2 tries, emit ready event so we can continue
    if (this.connectionEnabled) {
      this.connectionFailedTimeout = setTimeout(() => {
        if (!this.readyEventEmitted && !this.webSocketConnected) {
          this.log('warning', 'Failed to connect to sync backend')
          this.dispatchLibEvent(FavaLibEvent.Ready)

          this.dispatchLibEvent(
            FavaLibEvent.ConnectionToSyncServerStatusChanged,
            {
              newStatus: ConnectionStatus.FAILED,
            },
          )
        }
      }, this.reconnectInterval + 1000)
    }
  }

  private get libraryLoader() {
    return this.mediator.getComponent('libraryLoader')
  }

  private get cryptoLib() {
    return this.libraryLoader.getCryptoLib()
  }

  private get persistentStorageManager() {
    return this.mediator.getComponent('persistentStorageManager')
  }

  private get commandManager() {
    return this.mediator.getComponent('commandManager')
  }

  private get dispatchLibEvent() {
    return this.mediator.getComponent('dispatchLibEvent')
  }

  private get log() {
    return this.mediator.getComponent('log')
  }

  /**
   * @returns Whether an add device flow is currently active.
   */
  get inAddDeviceFlow(): boolean {
    return Boolean(this.activeAddDeviceFlow)
  }

  /**
   * @returns Whether the WebSocket connection is open.
   */
  get webSocketConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private sendToServer<T extends ClientMessage['type']>(
    type: T,
    data: Extract<ClientMessage, { type: T }>['data'],
  ) {
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }
    this.ws.send(JSON.stringify({ type, data }))
  }

  /**
   * Initializes the WebSocket connection to the server.
   */
  initServerConnection() {
    this.connectionEnabled = true
    this.shouldReconnect = true
    const WebSocketLib = this.libraryLoader.getWebSocketLib()
    const ws = new WebSocketLib(this.serverUrl)

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const syncManager = this

    ws.addEventListener('error', () => {
      // no error information seems to be available...
      syncManager.log('warning', `Error in websocket.`)
    })

    ws.addEventListener('message', function message(message: MessageEvent) {
      try {
        const jsonString = String(message.data)
        const parsedMessage = JSON.parse(jsonString) as ServerMessage

        syncManager.handleServerMessage(parsedMessage)
      } catch (error) {
        // A SyncError from handleServerMessage is a REFUSAL, not a parse
        // failure, and it is reported as itself. The two used to be flattened
        // together, which meant the loudest alarm in the sync path -- "got
        // vault data while no resilver was requested, probably replay attack!"
        // -- reached the user as "Failed to parse message", indistinguishable
        // from a truncated frame. See
        // key-hierarchy-review/15-sync-replay-protection.md.
        if (error instanceof SyncError) {
          syncManager.log('error', error.message)
          // eslint-disable-next-line no-restricted-globals
        } else if (error instanceof Error) {
          syncManager.log(
            'warning',
            `Failed to parse message: ${error.message}`,
          )
        } else {
          syncManager.log(
            'warning',
            `Failed to parse message: ${String(error)}`,
          )
        }
      }
    })

    ws.addEventListener('open', () => {
      this.log('info', 'Connected to server.')
      this.sendToServer('connect', { deviceId: syncManager.deviceId })
      this.dispatchLibEvent(FavaLibEvent.ConnectionToSyncServerStatusChanged, {
        newStatus: ConnectionStatus.CONNECTED,
      })

      clearTimeout(this.connectionFailedTimeout)
      this.connectionFailedTimeout = undefined

      // send any commands that were done while offline
      this.processCommandSendQueue()
    })
    ws.addEventListener('close', this.handleWebSocketClose.bind(this))

    this.ws = ws
  }
  private handleWebSocketClose(event: CloseEvent) {
    if (this.shouldReconnect) {
      this.dispatchLibEvent(FavaLibEvent.ConnectionToSyncServerStatusChanged, {
        newStatus: ConnectionStatus.CONNECTING,
      })

      // if we shouldn't reconnect, this closing is expected
      this.log('warning', `WebSocket closed: ${event.code} ${event.reason}`)
      this.attemptReconnect()
    } else {
      this.dispatchLibEvent(FavaLibEvent.ConnectionToSyncServerStatusChanged, {
        newStatus: ConnectionStatus.NOT_CONNECTED,
      })

      // Connection closed, no need to force terminate
      if (this.terminateTimeout) {
        clearTimeout(this.terminateTimeout)
      }
    }
  }

  private handleServerMessage(message: ServerMessage) {
    switch (message.type) {
      case 'confirmAddSyncDeviceInitialiseData': {
        if (this.activeAddDeviceFlow?.state !== 'initiator:initiated') {
          throw new SyncInWrongStateError(
            `Expected initiator:initiated, got ${this.activeAddDeviceFlow?.state}`,
          )
        }
        clearTimeout(this.activeAddDeviceFlow.timeout)
        this.activeAddDeviceFlow.resolveContinuePromise(message)
        break
      }
      case 'JPAKEPass2': {
        const { data } = message

        const unconvertedPass2Result = data.pass2Result
        const pass2Result = {
          round1Result: jsonToUint8Array(unconvertedPass2Result.round1Result),
          round2Result: jsonToUint8Array(unconvertedPass2Result.round2Result),
        } as unknown as Pass2Result

        void this.finishAddDeviceFlowKeyExchangeInitiator(
          pass2Result,
          data.responderDeviceId,
        )
        break
      }
      case 'JPAKEPass3': {
        const { data } = message

        const pass3Result = jsonToUint8Array(
          data.pass3Result,
        ) as unknown as Pass3Result

        void this.finishAddDeviceFlowKeyExchangeResponder(pass3Result)
        break
      }
      case 'publicKeyAndDeviceInfo': {
        const { data } = message
        const { responderEncryptedPublicKeys, responderEncryptedDeviceInfo } =
          data

        void this.sendFullVaultDataAndSetDeviceInfo(
          responderEncryptedPublicKeys,
          responderEncryptedDeviceInfo,
        )
        break
      }
      case 'initialVault': {
        const { data } = message
        const { encryptedVaultData } = data
        void this.importInitialVault(encryptedVaultData).catch((err: unknown) =>
          this.reportFailedVaultImport('initial vault', err),
        )
        break
      }
      case 'vault': {
        if (!this.requestedResilver) {
          throw new SyncError(
            'Got vault data while no resilver was requested, probably replay attack!',
          )
        }
        const { data } = message
        const {
          encryptedVaultData,
          encryptedSymmetricKey,
          fromDeviceId,
          forDeviceId,
          signature,
        } = data

        if (forDeviceId !== this.deviceId) {
          throw new SyncError('Got vault data for the wrong device!')
        }

        // `fromDeviceId` is stamped by the server, so on its own it is a claim.
        // The signature is what turns it into one: it has to verify under the
        // key this vault holds for that peer, which a server cannot produce and
        // a removed device no longer has a listing for.
        const sender = this.syncDevices.find(
          (device) => device.deviceId === fromDeviceId,
        )

        void (
          sender
            ? this.assertVaultDataSignature(
                sender.signingPublicKey,
                fromDeviceId,
                encryptedVaultData,
                signature,
              )
            : Promise.reject(
                new SyncError(
                  'Got vault data from a device that is not a peer',
                ),
              )
        )
          .then(() =>
            this.cryptoLib.decrypt(
              this.secretKeys.privateKey,
              encryptedSymmetricKey,
            ),
          )
          .then((symmetricKey) =>
            this.importVaultState(
              encryptedVaultData,
              symmetricKey,
              fromDeviceId,
            ),
          )
          // Neither of these is awaited by anything, so without a catch a
          // refused import is an unhandled rejection rather than something the
          // consumer can surface. importVaultState only started throwing on
          // malformed contents with
          // key-hierarchy-review/05-load-path-validation.md.
          .catch((err: unknown) =>
            this.reportFailedVaultImport('resilvered vault', err),
          )
        break
      }
      case 'syncCommandsReceived': {
        const {
          data: { commandIds },
        } = message
        void this.commandsSuccesfullyReceived(commandIds)
        break
      }
      case 'syncCommands': {
        const { data: commands } = message
        void this.receiveCommands(commands)
        break
      }
      case 'startResilver': {
        // const { data } = message
        // todo: check for missing deviceIds

        void this.resilver()
        break
      }
    }
  }

  private attemptReconnect() {
    this.log('info', 'Connection to server lost, attempting to reconnect...')

    this.reconnectTimeout = setTimeout(() => {
      this.initServerConnection()
    }, this.reconnectInterval)
  }

  /**
   * Initiates the process to add a new device.
   * @param returnAs - An object specifying what should be returned:
   *   - `qr: boolean` - If `true`, the result will include a QR code string in the `qr` property.
   *   - `text: boolean` - If `true`, the result will include initiation data in the `text` property.
   * @returns A promise that resolves to an object containing:
   *   - `qr`: If `returnAs.qr` is `true`, this will be a `string` containing the QR code; otherwise, `null`.
   *   - `text`: If `returnAs.text` is `true`, this will be an `InitiateAddDeviceFlowResult` object; otherwise, `null`.
   * @throws {SyncAddDeviceFlowConflictError} If an add device flow is already active.
   * @throws {SyncNoServerConnectionError} If there is no server connection.
   */
  async initiateAddDeviceFlow(returnAs: {
    qr: true
    text: true
  }): Promise<{ qr: string; text: string }>
  /**
   * @inheritdoc
   */
  async initiateAddDeviceFlow(returnAs: {
    qr: true
    text: false
  }): Promise<{ qr: string; text: null }>
  /**
   * @inheritdoc
   */
  async initiateAddDeviceFlow(returnAs: {
    qr: false
    text: true
  }): Promise<{ qr: null; text: string }>
  /**
   * @inheritdoc
   */
  async initiateAddDeviceFlow(returnAs: {
    qr: false
    text: false
  }): Promise<{ qr: null; text: null }>
  /**
   * @inheritdoc
   */
  async initiateAddDeviceFlow(returnAs: { qr: boolean; text: boolean }) {
    if (this.activeAddDeviceFlow) {
      throw new SyncAddDeviceFlowConflictError()
    }
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }

    const addDevicePassword = deriveSFromPassword(
      uint8ArrayToBase64(await this.cryptoLib.getRandomBytes(60)),
    )
    const timestamp = Date.now()

    const jpak = new JPakeThreePass(this.deviceId)
    const pass1Result = jpak.pass1()

    const continuePromise = new Promise((resolve, reject) => {
      // Set a timeout for if we get no response from the server
      const timeout = setTimeout(() => {
        if (this.activeAddDeviceFlow?.state === 'initiator:initiated') {
          reject(
            new FavaLibError(
              'Timeout of registerAddDeviceFlowRequest, no response',
            ),
          )
          this.activeAddDeviceFlow = undefined
        }
      }, 10000)

      this.activeAddDeviceFlow = {
        state: 'initiator:initiated',
        jpak,
        addDevicePassword,
        initiatorDeviceId: this.deviceId,
        timestamp,
        resolveContinuePromise: resolve,
        timeout,
      }
    })

    // register this add device request at the server
    this.sendToServer('addSyncDeviceInitialiseData', {
      initiatorDeviceId: this.deviceId,
      timestamp,
    })

    // wait for the server to confirm it has registered the add device request
    await continuePromise

    const returnData: InitiateAddDeviceFlowResult = {
      pairingVersion: PAIRING_VERSION,
      addDevicePassword: uint8ArrayToBase64(addDevicePassword),
      initiatorDeviceId: this.deviceId,
      timestamp,
      pass1Result: {
        G1: uint8ArrayToHex(pass1Result.G1),
        G2: uint8ArrayToHex(pass1Result.G2),
        ZKPx1: uint8ArrayToHex(pass1Result.ZKPx1),
        ZKPx2: uint8ArrayToHex(pass1Result.ZKPx2),
      },
    }

    let returnQr = null
    if (returnAs.qr) {
      const qrGeneratorLib = this.libraryLoader.getQrGeneratorLib()
      returnQr = await qrGeneratorLib.toDataURL(JSON.stringify(returnData))
    }
    const returnText = returnAs.text
      ? stringToBase64(JSON.stringify(returnData), { urlSafe: true })
      : null
    return {
      qr: returnQr,
      text: returnText,
    }
  }

  /**
   * Responds to an add device flow initiated by another device.
   * @param initiatorData The data received from the initiating device.
   * @param initiatorDataType The type of the initiatorData, determines how it should be decoded
   * @throws {SyncNoServerConnectionError} If there is no server connection.
   * @throws {SyncAddDeviceFlowConflictError} If an add device flow is already active.
   * @throws {SyncPairingVersionError} If the initiator speaks a different JPAKE wire version.
   * @throws {SyncError} If the initiator data is invalid.
   */
  async respondToAddDeviceFlow(
    initiatorData: string | Uint8Array | File,
    initiatorDataType: 'text' | 'qr',
  ) {
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }
    if (this.activeAddDeviceFlow) {
      throw new SyncAddDeviceFlowConflictError()
    }

    const {
      pairingVersion,
      addDevicePassword,
      initiatorDeviceId,
      timestamp,
      pass1Result,
    } = await decodeInitiatorData(
      initiatorData,
      initiatorDataType,
      await this.libraryLoader.getJsQrLib(),
      this.libraryLoader.getQrGeneratorLib(),
    )

    // Before anything else: an exchange with a peer on another JPAKE wire
    // version cannot succeed, and says so more clearly here than as a proof
    // failure three messages later.
    assertPairingVersionIsSupported(pairingVersion)

    if (
      !addDevicePassword ||
      !initiatorDeviceId ||
      !timestamp ||
      !pass1Result
    ) {
      throw new SyncError('Missing required fields in initiator data')
    }

    // Decode the base64 password
    const decodedPassword = base64ToUint8Array(addDevicePassword)

    const jpak = new JPakeThreePass(this.deviceId)

    // Process the first pass from the initiator
    const initiatorPass1Result = {
      G1: hexToUint8Array(pass1Result.G1),
      G2: hexToUint8Array(pass1Result.G2),
      ZKPx1: hexToUint8Array(pass1Result.ZKPx1),
      ZKPx2: hexToUint8Array(pass1Result.ZKPx2),
    }

    let pass2Result: Pass2Result
    try {
      pass2Result = jpak.pass2(
        initiatorPass1Result,
        decodedPassword,
        initiatorDeviceId,
      )
    } catch {
      throw new SyncError('Error processing initiator pass 1')
    }

    this.activeAddDeviceFlow = {
      state: 'responder:initated',
      jpak,
      addDevicePassword: decodedPassword,
      responderDeviceId: this.deviceId,
      initiatorDeviceId: initiatorDeviceId,
      timestamp: Date.now(),
    }

    // respond to this add device request at the server
    this.sendToServer('JPAKEPass2', {
      // @ts-expect-error we get a type mismatch because we input Uint8Array instead of JsonifiedUint8Array, but it will get jsonified later
      pass2Result,
      responderDeviceId: this.deviceId,
      initiatorDeviceId: initiatorDeviceId,
    })
  }

  private async finishAddDeviceFlowKeyExchangeInitiator(
    pass2Result: Pass2Result,
    responderDeviceId: DeviceId,
  ) {
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }

    if (this.activeAddDeviceFlow?.state !== 'initiator:initiated') {
      throw new SyncInWrongStateError(
        `Expected initiator:initiated, got ${this.activeAddDeviceFlow?.state}`,
      )
    }

    const pass3Result = this.activeAddDeviceFlow.jpak.pass3(
      pass2Result,
      this.activeAddDeviceFlow.addDevicePassword,
      responderDeviceId,
    )

    this.sendToServer('JPAKEPass3', {
      initiatorDeviceId: this.activeAddDeviceFlow.initiatorDeviceId,
      // @ts-expect-error we get a type mismatch because we input Uint8Array instead of JsonifiedUint8Array, but it will get jsonified later
      pass3Result,
    })

    const { key: sharedKey } = this.activeAddDeviceFlow.jpak.deriveSharedKey()
    const syncKey = await this.cryptoLib.createSyncKey(
      sharedKey,
      responderDeviceId as string as Salt,
    )
    this.activeAddDeviceFlow = {
      ...this.activeAddDeviceFlow,
      state: 'initiator:syncKeyCreated',
      responderDeviceId: responderDeviceId,
      syncKey,
    }
  }

  private async finishAddDeviceFlowKeyExchangeResponder(
    pass3Result: Pass3Result,
  ) {
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }

    if (this.activeAddDeviceFlow?.state !== 'responder:initated') {
      throw new SyncInWrongStateError(
        `Expected responder:initiated, got ${this.activeAddDeviceFlow?.state}`,
      )
    }

    if (!this.publicKeys.publicKey) {
      throw new SyncError('Public key not set')
    }

    this.activeAddDeviceFlow.jpak.receivePass3Results(pass3Result)

    const { key: sharedKey } = this.activeAddDeviceFlow.jpak.deriveSharedKey()
    const syncKey = await this.cryptoLib.createSyncKey(
      sharedKey,
      this.activeAddDeviceFlow.responderDeviceId as string as Salt,
    )
    this.activeAddDeviceFlow = {
      ...this.activeAddDeviceFlow,
      state: 'responder:syncKeyCreated',
      syncKey,
    }

    const handshakeAad = buildHandshakeAad(
      this.activeAddDeviceFlow.initiatorDeviceId,
      this.activeAddDeviceFlow.responderDeviceId,
    )
    // Both public keys, as one JSON payload: a peer that knows only where to
    // seal to but not whose signature to expect cannot verify anything this
    // device sends, so the two always travel together.
    const responderEncryptedPublicKeys = await this.cryptoLib.encryptSymmetric(
      syncKey,
      JSON.stringify(this.publicKeys) as PublicKeysString,
      handshakeAad,
    )
    const responderEncryptedDeviceInfo = await this.cryptoLib.encryptSymmetric(
      syncKey,
      JSON.stringify(this.deviceInfo),
      handshakeAad,
    )

    // send our public keys
    this.sendToServer('publicKeyAndDeviceInfo', {
      responderEncryptedPublicKeys,
      responderEncryptedDeviceInfo,
      initiatorDeviceId: this.activeAddDeviceFlow.initiatorDeviceId,
    })
  }

  private async sendFullVaultDataAndSetDeviceInfo(
    responderEncryptedPublicKeys: EncryptedPublicKeys,
    responderEncryptedDeviceInfo: Encrypted<string>,
  ) {
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }

    if (this.activeAddDeviceFlow?.state !== 'initiator:syncKeyCreated') {
      throw new SyncInWrongStateError(
        `Expected initiator:syncKeyCreated, got ${this.activeAddDeviceFlow?.state}`,
      )
    }

    if (!this.publicKeys.publicKey) {
      throw new SyncError('Public key not set')
    }

    const syncKey = this.activeAddDeviceFlow.syncKey
    const handshakeAad = buildHandshakeAad(
      this.activeAddDeviceFlow.initiatorDeviceId,
      this.activeAddDeviceFlow.responderDeviceId,
    )

    // Decrypt the received public keys. Shape-checked before use: they arrive
    // under the JPAKE-derived key, so this is not a trust boundary, but a
    // responder on a build that sends something else should fail here and not
    // three messages later inside a curve.
    const decryptedPublicKeys = parseDevicePublicKeys(
      await this.cryptoLib.decryptSymmetric(
        syncKey,
        responderEncryptedPublicKeys,
        handshakeAad,
      ),
    )

    // decrypt the received device info
    const responderDeviceInfo = JSON.parse(
      await this.cryptoLib.decryptSymmetric(
        syncKey,
        responderEncryptedDeviceInfo,
        handshakeAad,
      ),
    ) as DeviceInfo

    // get the vault data (encrypted with the sync key)
    const encryptedVaultData =
      await this.persistentStorageManager.getEncryptedVaultState(
        syncKey,
        this.activeAddDeviceFlow.responderDeviceId,
        buildVaultDataAad(
          this.deviceId,
          this.activeAddDeviceFlow.responderDeviceId,
        ),
      )

    // Send the encrypted vault data to the server. No signature: it is
    // encrypted under the JPAKE-derived sync key, which only a party that knew
    // the out-of-band secret can hold. See importInitialVault.
    this.sendToServer('initialVault', {
      encryptedVaultData,
      initiatorDeviceId: this.activeAddDeviceFlow.initiatorDeviceId,
    })

    // save the added the sync device, done via command so this is synced to all sync devices
    const command = AddSyncDeviceCommand.create({
      deviceId: this.activeAddDeviceFlow.responderDeviceId,
      publicKey: decryptedPublicKeys.publicKey,
      signingPublicKey: decryptedPublicKeys.signingPublicKey,
      deviceInfo: responderDeviceInfo,
    })
    await this.commandManager.execute(command)

    // all done
    this.activeAddDeviceFlow = undefined
  }

  private async importInitialVault(
    encryptedVaultState: EncryptedVaultStateString,
  ) {
    if (this.activeAddDeviceFlow?.state !== 'responder:syncKeyCreated') {
      throw new SyncInWrongStateError(
        `Expected responder:syncKeyCreated, got ${this.activeAddDeviceFlow?.state}`,
      )
    }

    // Deliberately NOT signature-checked, unlike a resilver. This vault arrives
    // under the JPAKE-derived sync key, and reaching that key means proving
    // knowledge of the 60-byte out-of-band secret -- so the channel is already
    // mutually authenticated, and a signature would be a second statement by
    // the same party. It is also where the responder LEARNS the initiator's
    // signing key, from the device list inside this vault, which is sound for
    // exactly the same reason.
    await this.importVaultState(
      encryptedVaultState,
      this.activeAddDeviceFlow.syncKey,
      this.activeAddDeviceFlow.initiatorDeviceId,
    )

    // Reset the active add device flow
    this.activeAddDeviceFlow = undefined
    this.dispatchLibEvent(FavaLibEvent.ConnectToExistingVaultFinished)
  }

  /**
   * Reports a vault import that was refused, without letting it escape as an
   * unhandled rejection.
   * @param what - Which import failed, for the message.
   * @param err - The thrown value.
   */
  private reportFailedVaultImport(what: string, err: unknown) {
    // eslint-disable-next-line no-restricted-globals
    const detail = err instanceof Error ? err.message : 'unknown error'
    this.log('warning', `Could not import the ${what}: ${detail}`)
  }

  private async importVaultState(
    encryptedVaultState: EncryptedVaultStateString,
    symmetricKey: SymmetricKey,
    expectedDeviceId: DeviceId,
  ) {
    const vaultState = JSON.parse(
      await this.cryptoLib.decryptSymmetric(
        symmetricKey,
        encryptedVaultState,
        // expectedDeviceId is the sender; we are always the recipient. The
        // deviceId checks below are on plaintext INSIDE the ciphertext, so
        // binding both ids here is what makes them mean anything to someone
        // who did not hold the key.
        buildVaultDataAad(expectedDeviceId, this.deviceId),
      ),
    ) as VaultStateSend

    if (vaultState.deviceId !== expectedDeviceId) {
      throw new SyncError(
        `DeviceId mismatch when importing, expected ${expectedDeviceId} got ${vaultState.deviceId}`,
      )
    }
    if (vaultState.forDeviceId !== this.deviceId) {
      throw new SyncError(
        `For deviceId mismatch when importing, expected ${this.deviceId} got ${vaultState.forDeviceId}`,
      )
    }

    // Both of these are plain `as VaultStateSend` casts over a decrypted JSON
    // blob, so neither is known to be an array, let alone to hold what it
    // claims. A `for...of` over a number is a raw TypeError out of a promise
    // nobody awaits.
    if (!Array.isArray(vaultState.sync?.devices)) {
      throw new SyncError('Imported vault state has no sync device list')
    }
    if (!Array.isArray(vaultState.vault)) {
      throw new SyncError('Imported vault state has no entry list')
    }

    // Checked in full BEFORE anything is applied, so a bad record halfway
    // down the list cannot leave the vault half-imported. addSyncDevice would
    // reject the device on its own, but only after the ones before it were
    // already pushed.
    //
    // The entries need checking here regardless: vaultDataManager.addEntry only
    // runs sanitiseEntry, which repairs the three matching fields and never
    // looks at the payload.
    for (const entry of vaultState.vault) {
      const reason = validateEntryFatal(entry)
      if (reason) {
        throw new SyncError(
          `Refusing to import vault state: it contains an unusable entry ` +
            `(${reason})`,
        )
      }
    }
    for (const device of vaultState.sync.devices) {
      const reason = validateSyncDevice(device)
      if (reason) {
        throw new SyncError(
          `Refusing to import vault state: it contains an unusable sync ` +
            `device (${reason})`,
        )
      }
    }

    for (const device of vaultState.sync.devices) {
      await this.addSyncDevice(device, false)
    }

    const vaultDataManager = this.mediator.getComponent('vaultDataManager')
    for (const entry of vaultState.vault) {
      await vaultDataManager.addEntry(entry, false)
    }
    await this.persistentStorageManager.save()
  }

  /**
   * Cancels the active add sync device flow.
   * @throws {SyncNoServerConnectionError} If there is no server connection.
   * @throws {SyncInWrongStateError} If there is no active add device flow.
   */
  cancelAddSyncDevice() {
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }
    if (!this.activeAddDeviceFlow) {
      throw new SyncInWrongStateError(
        'Trying to cancel addSyncDevice while not active',
      )
    }
    this.sendToServer('addSyncDeviceCancelled', {
      initiatorDeviceId: this.activeAddDeviceFlow.initiatorDeviceId,
    })
    // Reset the active add device flow
    this.activeAddDeviceFlow = undefined
    this.dispatchLibEvent(FavaLibEvent.ConnectToExistingVaultFinished)
  }

  /**
   * Sends a command to the server to synchronize with other devices.
   * @param command - The command to be sent.
   * @throws {SyncNoServerConnectionError} If there is no server connection.
   */
  async sendCommand(command: Command) {
    const commandJson = command.toJSON()

    await Promise.all(
      this.syncDevices.map(async (device) => {
        if (device.deviceId === this.deviceId) {
          // skip ourselves
          return
        }

        // The exact bytes that get signed and then sealed. The command id is
        // INSIDE now -- it used to be stripped here and taken from the server's
        // envelope on the other side, which made the dedup key something the
        // server chose (key-hierarchy-review/15-sync-replay-protection.md).
        const payload = JSON.stringify({
          ...commandJson,
          padding: generateNonCryptographicRandomString(), // make it harder to guess the length
        })

        // Signed per recipient, not once for all of them: the recipient is part
        // of what is signed, so one signature for every peer would be a
        // signature that says nothing about who a command was meant for.
        const signature = await this.cryptoLib.sign(
          this.secretKeys.signingSecretKey,
          buildCommandSignatureMessage(
            command.id,
            this.deviceId,
            device.deviceId,
            payload,
          ),
        )

        // unique symmetricKey per command
        const symmetricKey = await this.cryptoLib.createSymmetricKey()
        const encryptedSymmetricKey = await this.cryptoLib.encrypt(
          device.publicKey,
          symmetricKey,
        )
        // The signature goes INSIDE the ciphertext, with the sender's id. The
        // server relays the envelope untouched and learns nothing about who is
        // talking to whom -- and cannot strip a signature either, because a
        // payload without one is refused on the other side.
        const encryptedCommand = await this.cryptoLib.encryptSymmetric(
          symmetricKey,
          JSON.stringify({
            from: this.deviceId,
            signature,
            payload,
          } satisfies SignedCommandEnvelope),
          buildCommandAad(command.id, device.deviceId),
        )

        this.commandSendQueue.push({
          commandId: command.id,
          deviceId: device.deviceId,
          encryptedSymmetricKey,
          encryptedCommand,
        })
      }),
    )

    // A command that cannot leave now has to survive until it can. The vault
    // was already saved, before this command reached the queue, so nothing
    // else will persist it - and a short-lived consumer like the cli exits
    // before the connection ever comes back.
    if (!this.webSocketConnected) {
      await this.persistentStorageManager.save()
    }

    this.processCommandSendQueue()
  }

  /**
   * Waits until the server has acknowledged every queued outgoing command.
   *
   * Sending is otherwise fire-and-forget: `sendCommand` hands the commands to
   * the socket and returns, and the acknowledgement arrives later as a
   * `syncCommandsReceived` message. That is fine for a long-lived app, but a
   * process that exits right after a mutation - the cli - would take the
   * queue down with it.
   *
   * This only waits, it never re-sends: the queue is sent again in full on
   * the next connection anyway. A command the server already has is no
   * longer a problem for it - it recognises the repeat by
   * (commandId, deviceId) and acknowledges it again.
   * @param timeoutMs - How long to wait for the acknowledgement.
   * @returns True when the queue is empty, false when it could not be
   * flushed. In the false case the queue has been persisted, so the commands
   * go out the next time this device connects.
   */
  async flushCommandSendQueue(
    timeoutMs = COMMAND_FLUSH_TIMEOUT,
  ): Promise<boolean> {
    if (this.commandSendQueue.length === 0) {
      return true
    }

    if (!this.webSocketConnected) {
      // `sendCommand` already persisted the queue in this case
      return false
    }

    const flushed = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.commandSendQueueDrainedResolvers =
          this.commandSendQueueDrainedResolvers.filter(
            (waiter) => waiter !== onDrained,
          )
        resolve(false)
      }, timeoutMs)

      const onDrained = () => {
        clearTimeout(timeout)
        resolve(true)
      }

      this.commandSendQueueDrainedResolvers.push(onDrained)
    })

    if (!flushed) {
      await this.persistentStorageManager.save()
    }

    return flushed
  }

  private processCommandSendQueue() {
    if (this.syncDevices.length === 0) {
      // no devices to sync with, no need to send anything
      this.commandSendQueue = []
      this.resolveCommandSendQueueDrained()
      return
    }

    if (!this.ws || !this.webSocketConnected) {
      // not possible to process commands at this point
      if (this.connectionEnabled) {
        this.log(
          'warning',
          'Could not sync commands, no server connection, will retry later.',
        )
      }
      return
    }

    if (this.commandSendQueue.length === 0) {
      // no commands to sync
      return
    }

    this.sendToServer('syncCommands', {
      commands: this.commandSendQueue,
    })
  }

  /**
   * Handles the confirmation that the sever succesfully received (some) send commands
   * @param commandIds - The ids of the received commands
   */
  private commandsSuccesfullyReceived(commandIds: string[]) {
    // remove all succesfully received commands frm the queue
    this.commandSendQueue = this.commandSendQueue.filter(
      (command) => !commandIds.includes(command.commandId),
    )

    if (this.commandSendQueue.length === 0) {
      this.resolveCommandSendQueueDrained()
    }
  }

  /**
   * Wakes everyone waiting in `flushCommandSendQueue`.
   */
  private resolveCommandSendQueueDrained() {
    const waiters = this.commandSendQueueDrainedResolvers
    this.commandSendQueueDrainedResolvers = []
    for (const waiter of waiters) {
      waiter()
    }
  }

  /**
   * Refuses a command this device has already applied, or one old enough that
   * it can no longer prove it has not.
   *
   * Two checks, because the record of what has been applied is deliberately
   * bounded (see `recordProcessedCommands`):
   *
   * - an id still in `processedCommands` is a duplicate outright;
   * - a command at or below its sender's floor is one whose id may have been
   *   pruned, so it is refused rather than guessed at.
   *
   * The floor is per peer and only ever rises when that peer's OWN traffic is
   * pruned, which is what keeps this from punishing a device that has been
   * offline for a long time: a quiet peer's floor stays where it was, and its
   * queued commands still apply when it comes back.
   *
   * Note what this is NOT for. A malicious server cannot re-deliver a stored
   * blob under a fresh id -- the command id is in the AAD and inside the signed
   * payload, so a changed id fails to decrypt and then fails to verify. This is
   * about the same id arriving twice, which the server does routinely and
   * legitimately on every reconnect, and which used to be caught only by an
   * in-memory set that a restart emptied.
   * @param from - The peer that signed the command.
   * @param command - The verified command.
   * @throws {SyncError} If the command has been applied before.
   */
  private assertNotReplayed(from: DeviceId, command: SyncCommand): void {
    if (this.processedCommands.some((seen) => seen.id === command.id)) {
      throw new SyncError('Command has already been applied')
    }
    const floor = this.replayFloors[from]
    if (floor !== undefined && (command.timestamp ?? 0) <= floor) {
      throw new SyncError("Command is older than this peer's replay floor")
    }
  }

  /**
   * Notes where a verified command came from until it has been applied.
   * @param commandId - The command's id.
   * @param origin - The peer that signed it and the timestamp it carried.
   */
  private rememberCommandOrigin(
    commandId: string,
    origin: { from: DeviceId; timestamp: number },
  ): void {
    this.pendingCommandOrigins.set(commandId, origin)
    // Map iterates in insertion order, so the first key is the oldest.
    while (this.pendingCommandOrigins.size > MAX_PENDING_COMMAND_ORIGINS) {
      const oldest = this.pendingCommandOrigins.keys().next()
      if (oldest.done) {
        break
      }
      this.pendingCommandOrigins.delete(oldest.value)
    }
  }

  /**
   * Records the commands that were just applied, and prunes the record.
   *
   * Bounded two ways, because "remember every command id forever" is a vault
   * that grows without limit: anything older than REPLAY_RETENTION_MS goes, and
   * so does anything beyond MAX_PROCESSED_COMMANDS, oldest first. Pruning an
   * entry raises its sender's floor to that entry's timestamp, so forgetting an
   * id never makes it acceptable again -- the set shrinks without the
   * protection weakening.
   * @param executedIds - The ids `processRemoteCommands` reported as applied.
   */
  private async recordProcessedCommands(executedIds: string[]): Promise<void> {
    let changed = false
    for (const id of executedIds) {
      const origin = this.pendingCommandOrigins.get(id)
      this.pendingCommandOrigins.delete(id)
      if (!origin) {
        // A locally issued command, or one this device did not verify. Only
        // remote commands can be replayed at it.
        continue
      }
      this.processedCommands.push({ id, ...origin })
      changed = true
    }
    if (!changed) {
      return
    }

    const cutoff = Date.now() - REPLAY_RETENTION_MS
    const kept: ProcessedCommand[] = []
    const pruned: ProcessedCommand[] = []
    // Oldest first, so the count bound drops the oldest rather than whichever
    // happened to be at the front of the array.
    const ordered = [...this.processedCommands].sort(
      (a, b) => a.timestamp - b.timestamp,
    )
    for (const entry of ordered) {
      const tooOld = entry.timestamp < cutoff
      const tooMany = ordered.length - pruned.length > MAX_PROCESSED_COMMANDS
      if (tooOld || tooMany) {
        pruned.push(entry)
      } else {
        kept.push(entry)
      }
    }
    for (const entry of pruned) {
      this.replayFloors[entry.from] = Math.max(
        this.replayFloors[entry.from] ?? 0,
        entry.timestamp,
      )
    }
    this.processedCommands = kept

    // The vault has to be written even when no command changed a single entry:
    // the record of what has been applied is itself the thing that must survive
    // a restart.
    await this.persistentStorageManager.save()
  }

  /**
   * Checks that a full vault state was signed by the peer it claims to be from.
   *
   * A resilver is the one message that carries the whole vault, and it was as
   * unauthenticated as commands were: it is sealed to this device's public key,
   * and sealing is a public operation. The `fromDeviceId` on it is stamped by
   * the server. This is what makes it mean something.
   *
   * The initial vault of a pairing flow does NOT come through here -- see
   * importInitialVault for why the JPAKE key already settles that one.
   * @param signingPublicKey - The key this vault holds for the claimed sender.
   * @param fromDeviceId - The device the vault data claims to be from.
   * @param encryptedVaultData - The sealed vault state, as it arrived.
   * @param signature - The signature that travelled with it.
   * @throws {SyncError} If the signature is absent or does not verify.
   */
  private async assertVaultDataSignature(
    signingPublicKey: SigningPublicKey,
    fromDeviceId: DeviceId,
    encryptedVaultData: EncryptedVaultStateString,
    signature: Signature | undefined,
  ): Promise<void> {
    const signatureIsValid =
      typeof signature === 'string' &&
      (await this.cryptoLib.verify(
        signingPublicKey,
        buildVaultDataSignatureMessage(
          fromDeviceId,
          this.deviceId,
          encryptedVaultData,
        ),
        signature,
      ))
    if (!signatureIsValid) {
      throw new SyncError('Vault data signature does not verify')
    }
  }

  /**
   * Checks that a decrypted command really came from the peer it names.
   *
   * Everything this does is a refusal, and the order is deliberate: shape, then
   * sender, then signature, then the id. Each step is what makes the next one
   * meaningful, and no step reports which one failed -- `receiveCommands` turns
   * every throw here into the same warning, because telling a prober whether a
   * device id is known is already telling them something.
   *
   * The signature is the whole point (see
   * key-hierarchy-review/13-sync-command-authentication.md). Sealing a command
   * to this device's public key proves nothing about who sealed it: sealing is
   * a public operation, so before this check anyone holding a device's public
   * key could mint commands for it. Now a command is only acted on if a device
   * CURRENTLY in this vault's peer list signed it, for this recipient, under
   * this command id -- which is also what finally makes `removeSyncDevice` a
   * revocation rather than bookkeeping.
   * @param commandId - The id the server delivered the command under.
   * @param envelope - The decrypted envelope, which may be anything at all.
   * @returns The command and the id of the peer that signed it.
   * @throws {SyncError} If the envelope is not a command from a known peer.
   */
  private async verifyCommandEnvelope(
    commandId: string,
    envelope: Partial<SignedCommandEnvelope>,
  ): Promise<{ command: SyncCommand; from: DeviceId }> {
    const { from, signature, payload } = envelope
    if (
      typeof from !== 'string' ||
      typeof signature !== 'string' ||
      typeof payload !== 'string'
    ) {
      throw new SyncError('Command envelope is not signed')
    }

    // Never this device itself: a command signed by our own key can only be one
    // the server reflected back at us.
    const sender = this.syncDevices.find(
      (device) => device.deviceId === from && device.deviceId !== this.deviceId,
    )
    if (!sender) {
      throw new SyncError('Command is from a device that is not a peer')
    }

    const signatureIsValid = await this.cryptoLib.verify(
      sender.signingPublicKey,
      buildCommandSignatureMessage(commandId, from, this.deviceId, payload),
      signature,
    )
    if (!signatureIsValid) {
      throw new SyncError('Command signature does not verify')
    }

    const command = JSON.parse(payload) as SyncCommand
    // The signed payload carries the id, and the server's envelope carries it
    // too. They have to agree, because only the signed one is authenticated and
    // only the envelope one is what the dedup set and the AAD were built from.
    if (command.id !== commandId) {
      throw new SyncError('Command id does not match its envelope')
    }

    return { command, from }
  }

  /**
   * Receives and processes commands from other devices.
   * @param encryptedCommands - The commands
   * @throws {CryptoError} If decryption fails.
   */
  async receiveCommands(encryptedCommands: SyncCommandFromServer[]) {
    await Promise.all(
      encryptedCommands.map(async (data) => {
        // Per-command, deliberately. These run inside a Promise.all, so
        // without this one undecryptable command -- a peer that has not
        // upgraded past the v1 envelope, a row the server has held since
        // before the upgrade, or an outright hostile one -- would reject the
        // whole batch and take processRemoteCommands and the ready event down
        // with it. Dropping one command loses nothing permanently: it is never
        // reported in syncCommandsExecuted, so the server redelivers it.
        try {
          const symmetricKey = await this.cryptoLib.decrypt(
            this.secretKeys.privateKey,
            data.encryptedSymmetricKey,
          )

          const { command, from } = await this.verifyCommandEnvelope(
            data.commandId,
            JSON.parse(
              await this.cryptoLib.decryptSymmetric(
                symmetricKey,
                data.encryptedCommand,
                buildCommandAad(data.commandId, this.deviceId),
              ),
            ) as Partial<SignedCommandEnvelope>,
          )
          this.assertNotReplayed(from, command)
          this.rememberCommandOrigin(command.id, {
            from,
            timestamp: command.timestamp ?? 0,
          })
          this.commandManager.receiveRemoteCommand(command)
        } catch {
          // No detail in the message: which of the several possible causes it
          // was -- undecryptable, unsigned, signed by a device this vault does
          // not know, or a replay -- is exactly what an attacker probing the
          // sync path wants told.
          this.log(
            'warning',
            `Dropping remote command ${data.commandId}: it could not be ` +
              `decrypted, was not authentic, or had already been applied. It ` +
              `will be retried if the sending device is still on a compatible ` +
              `version.`,
          )
        }
      }),
    )

    const commandsExecutedIds =
      await this.commandManager.processRemoteCommands()

    // Recorded only for commands that actually ran, so a command dropped for
    // any other reason is still redeliverable, and persisted because the point
    // of the record is to outlive the process. See
    // key-hierarchy-review/15-sync-replay-protection.md.
    await this.recordProcessedCommands(commandsExecutedIds)

    // if this was the first time we received commands,
    // we can signal that we're done loading after the commands where processed
    if (!this.readyEventEmitted) {
      this.readyEventEmitted = true
      this.dispatchLibEvent(FavaLibEvent.Ready)
    }

    if (commandsExecutedIds.length > 0) {
      this.sendToServer('syncCommandsExecuted', {
        commandIds: commandsExecutedIds,
      })
    }
  }

  /**
   * Sends vault data to the server for each sync device
   */
  private async resilver() {
    for (const device of this.syncDevices) {
      if (device.deviceId === this.deviceId) {
        continue
      }

      const symmetricKey = await this.cryptoLib.createSymmetricKey()
      const encryptedSymmetricKey = await this.cryptoLib.encrypt(
        device.publicKey,
        symmetricKey,
      )
      const encryptedVaultData =
        await this.persistentStorageManager.getEncryptedVaultState(
          symmetricKey,
          device.deviceId,
          buildVaultDataAad(this.deviceId, device.deviceId),
        )

      this.sendToServer('vault', {
        forDeviceId: device.deviceId,
        encryptedVaultData,
        encryptedSymmetricKey,
        signature: await this.cryptoLib.sign(
          this.secretKeys.signingSecretKey,
          buildVaultDataSignatureMessage(
            this.deviceId,
            device.deviceId,
            encryptedVaultData,
          ),
        ),
      })
    }
  }

  /**
   * Add a sync device
   * @param device - The device to add
   * @param saveAfter - Whether to save the new vault after adding it (set to false when adding multiple devices)
   */
  async addSyncDevice(device: SyncDevice, saveAfter = true) {
    // The single chokepoint for every route a peer device can arrive by:
    // importVaultState, AddSyncDeviceCommand, and this device's own
    // registration from the constructor. The load path is the one exception --
    // it assigns syncDevices directly, so creationUtils runs the same two
    // checks itself.
    //
    // A shape gate only. It stops a garbage record; it does nothing about a
    // well formed one carrying an attacker's key, which is
    // key-hierarchy-review/14-sync-device-injection.md and still open.
    const reason = validateSyncDevice(device)
    if (reason) {
      throw new SyncError(`Refusing to add sync device: ${reason}`)
    }
    if (this.syncDevices.some((d) => d.deviceId === device.deviceId)) {
      // we already have this device
      return
    }
    if (this.syncDevices.length >= MAX_SYNC_DEVICES) {
      throw new SyncError(
        `Refusing to add sync device ${device.deviceId}: this vault already ` +
          `has the maximum of ${MAX_SYNC_DEVICES} devices`,
      )
    }
    this.log('info', `Adding syncdevice ${device.deviceId} to ${this.deviceId}`)
    this.syncDevices.push({
      ...device,
    })

    if (saveAfter) {
      await this.persistentStorageManager.save()
    }
  }

  /**
   * Remove a sync device
   * @param deviceId - The id of the device to remove
   * @param saveAfter - Whether to save the vault after removing the device
   * @returns The removed device, or undefined if it was not present
   */
  async removeSyncDevice(
    deviceId: DeviceId,
    saveAfter = true,
  ): Promise<SyncDevice | undefined> {
    const index = this.syncDevices.findIndex((d) => d.deviceId === deviceId)
    if (index === -1) {
      // we don't have this device, nothing to remove
      return undefined
    }
    this.log('info', `Removing syncdevice ${deviceId} from ${this.deviceId}`)
    const [removed] = this.syncDevices.splice(index, 1)

    if (saveAfter) {
      await this.persistentStorageManager.save()
    }

    return removed
  }

  /**
   * Requests a resilver of the vault
   */
  requestResilver() {
    this.sendToServer('startResilver', {
      deviceIds: this.syncDevices.map((d) => d.deviceId),
    })

    // Set requestedResilver to true for 60 seconds, after this we no longer
    // accept vault data
    this.requestedResilver = true
    if (this.requestedResilverTimeout) {
      clearTimeout(this.requestedResilverTimeout)
    }
    this.requestedResilverTimeout = setTimeout(
      () => (this.requestedResilver = false),
      60 * 1000,
    )
  }

  /**
   * Function to call when the server connection should be closed
   */
  public closeServerConnection() {
    this.shouldReconnect = false
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
    if (this.ws) {
      const ws = this.ws
      this.ws = undefined

      ws.close()
    }
  }
}

export default SyncManager
