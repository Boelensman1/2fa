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
  AddDeviceFlowResult,
  InitiateAddDeviceFlowResult,
  SyncDevice,
  SyncDeviceEnrolmentRoute,
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
import { createConnectProof } from '../utils/connectAuth.mjs'
import { validateEntryFatal } from '../utils/entryValidation.mjs'
import {
  MAX_REMOVED_DEVICES,
  MAX_SYNC_DEVICES,
  parseDevicePublicKeys,
  validateSyncDevice,
} from '../utils/syncDeviceValidation.mjs'
import type { ServerSecret } from '../interfaces/BrandedTypes.mjs'
import { deviceFingerprint } from '../utils/deviceFingerprint.mjs'
import { deviceLabel } from '../utils/deviceLabel.mjs'
import { containsUnsafeText } from '../utils/safeText.mjs'
import type {
  DevicePublicKeys,
  DeviceSecretKeys,
  Encrypted,
  EncryptedPublicKeys,
  PublicKeysString,
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
  SyncDeviceKeyConflictError,
  SyncDeviceRemovedError,
  SyncInWrongStateError,
  SyncNoServerConnectionError,
  SyncPairingVersionError,
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

const generateNonCryptographicRandomString = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const length = Math.floor(Math.random() * 64) + 1
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join('')
}

/**
 * The close code the sync server refuses a connection with.
 *
 * In the 4000-4999 range the WebSocket spec leaves to applications. One code
 * for every way the handshake can fail -- a wrong secret, a message sent before
 * the proof, a proof that never arrived -- because a server that distinguishes
 * them is answering questions for whoever is probing it. The client cannot tell
 * those apart either, which is why the message it logs names the likeliest
 * cause rather than the actual one.
 */
const SYNC_SERVER_UNAUTHORIZED_CLOSE_CODE = 4401

/** How long the HTTP probe in a connection diagnosis waits for an answer. */
const HTTP_PROBE_TIMEOUT_MS = IN_TESTING ? 200 : 5000

/** What a sync server answers a request that is not a WebSocket upgrade with. */
const HTTP_UPGRADE_REQUIRED = 426

/**
 * Turns whatever `fetch` rejected with into something worth printing.
 *
 * `fetch` fails with a bare "fetch failed" and hides the useful half in
 * `cause`: the errno (ECONNREFUSED, ENOTFOUND) or the TLS reason. A browser
 * gives neither and may be refusing the request itself, so say so rather than
 * let "failed" be read as "nothing is listening".
 * @param err - The value fetch rejected with.
 * @returns A description of the failure.
 */
const describeFetchFailure = (err: unknown): string => {
  // eslint-disable-next-line no-restricted-globals
  if (!(err instanceof Error)) {
    return String(err)
  }
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return `no answer within ${HTTP_PROBE_TIMEOUT_MS}ms`
  }
  const cause: unknown = err.cause
  const causeDetail =
    // eslint-disable-next-line no-restricted-globals
    cause instanceof Error
      ? ((cause as { code?: string }).code ?? cause.message)
      : typeof cause === 'string'
        ? cause
        : undefined
  const detail = causeDetail ?? err.message
  return detail
    ? `${detail} (the host may be unreachable, or a browser may have blocked the probe)`
    : 'no reason given (the host may be unreachable, or a browser may have blocked the probe)'
}

/** What `addSyncDevice` needs to know beyond the record itself. */
export interface AddSyncDeviceOptions {
  /**
   * How this device came to be here. Required rather than defaulted, for the
   * reason `getEncryptedVaultState` requires its `aad`: a default would make
   * the wrong one the easy one to reach for.
   */
  via: SyncDeviceEnrolmentRoute
  /** The verified peer that introduced it, when `via` is 'peer'. */
  by?: DeviceId
  /** Whether to save after adding (false when adding several). */
  saveAfter?: boolean
  /**
   * Whether a peer introduction is news.
   *
   * Defaults to true, unlike `via`, because silence is the dangerous value
   * here: a route added later that forgets to say anything gets the noisy
   * behaviour rather than the quiet one.
   *
   * `importVaultState` passes false for the INITIAL pairing import only. Every
   * device in that list is the baseline of a vault the user deliberately chose
   * to join, so warning about each one is asking them to vet a decision they
   * had just finished making -- and N notices they cannot act on is how the one
   * that matters goes unread. Provenance is untouched: the record is still
   * `via: 'peer'`, still stamped with the initiator as `by`, so `getSyncDevices`
   * and any later audit see exactly what they saw before.
   */
  announce?: boolean
}

/**
 * Manages synchronization of 2FA devices and communication with the server.
 */
class SyncManager {
  private ws?: WebSocket
  private activeAddDeviceFlow?: ActiveAddDeviceFlow
  private readonly reconnectInterval: number = IN_TESTING ? 100 : 5000 // 5 seconds
  readonly serverUrl: string
  readonly serverSecret: ServerSecret
  private syncDevices: SyncDevice[]

  /**
   * How far this socket has got through the server's connection gate.
   *
   * Reset on every `initServerConnection`, so a reconnect proves itself again
   * rather than inheriting the last socket's standing. Nothing but `authProof`
   * is sent while this is not `authenticated`.
   */
  private authState:
    'awaiting-challenge' | 'awaiting-accept' | 'authenticated' =
    'awaiting-challenge'

  private readyEventEmitted = false

  private commandSendQueue: SyncCommandFromClient[] = []
  private commandSendQueueDrainedResolvers: (() => void)[] = []

  private reconnectTimeout?: NodeJS.Timeout
  private terminateTimeout?: NodeJS.Timeout
  private connectionFailedTimeout?: NodeJS.Timeout
  private shouldReconnect = true

  /**
   * What the last socket attempt was last seen doing, for the failure message.
   *
   * The WebSocket api gives a client almost nothing about a handshake that did
   * not happen -- deliberately, so a page cannot use it to probe the network --
   * so this is assembled from what we do see: the close code and reason, if any
   * arrived, and how far through the server's gate the socket got.
   */
  private lastSocketFailure?: string

  private requestedResilver = false
  private requestedResilverTimeout?: NodeJS.Timeout

  /**
   * Remote commands this device has applied, as persisted in the vault.
   *
   * The in-memory set CommandManager keeps still gates `execute`, but it
   * empties on every restart, and the server re-sends everything it has not
   * been told was executed. This is the half that survives.
   */
  private processedCommands: ProcessedCommand[]

  /**
   * Per peer, the newest timestamp whose command id has been pruned from
   * `processedCommands`. Anything at or below it is refused.
   */
  private replayFloors: Record<DeviceId, number>

  /**
   * Device ids this vault has removed, against when.
   *
   * What makes `removeSyncDevice` converge. See VaultSyncState.removedDevices.
   */
  private removedDevices: Record<DeviceId, number>

  /** Serializes incoming batches, including their replay-state saves. */
  private commandReceiveQueue: Promise<void> = Promise.resolve()

  /** Remains set after a failed save; no acknowledgments may bypass that save. */
  private replayStateDirty = false

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
   * Public getter for the removal tombstones, for persistence.
   * @returns The device ids this vault has removed, against when.
   */
  public getRemovedDevices(): VaultSyncState['removedDevices'] {
    return this.removedDevices
  }

  /**
   * Public getter for the sync devices.
   *
   * Carries no key material, but does carry a FINGERPRINT of it: the one
   * property of a peer that the peer did not choose. `deviceFriendlyName` and
   * `deviceType` are whatever the device said about itself, so they can
   * describe anything; the fingerprint is derived from the keys this vault will
   * actually seal to and verify against, and is short enough to read aloud.
   *
   * `acknowledged` is false only for a device a peer introduced and that no
   * consumer has said it surfaced yet -- it gates nothing.
   * @returns The sync devices, without their public keys.
   */
  public getSyncDevices(): PublicSyncDevice[] {
    return this.syncDevices
      .filter((d) => d.deviceId !== this.deviceId)
      .map((d) => ({
        deviceId: d.deviceId,
        ...d.deviceInfo,
        fingerprint: deviceFingerprint(d),
        enrolment: d.enrolment,
        acknowledged: d.acknowledgedAt !== undefined,
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
    const {
      serverUrl,
      serverSecret,
      devices,
      commandSendQueue,
      processedCommands,
      removedDevices,
    } = syncState

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
    this.removedDevices = removedDevices ?? {}
    this.serverUrl = serverUrl
    this.serverSecret = serverSecret
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
      { via: 'self', saveAfter: false },
    )

    // if not yet connected after 2 tries, emit ready event so we can continue
    if (this.connectionEnabled) {
      this.connectionFailedTimeout = setTimeout(() => {
        if (!this.readyEventEmitted && !this.webSocketConnected) {
          this.log('warning', this.describeConnectionFailure())
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
   * @returns Whether the socket is open, whatever it is allowed to say on it.
   */
  private get socketOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * @returns Whether there is a usable connection to the sync server.
   *
   * Open is not enough any more: the server refuses every message from a socket
   * that has not proved the shared secret, so a pairing flow started between
   * `open` and `authAccepted` would have its connection closed under it rather
   * than get an error it could act on. Every caller gates on this, and it means
   * BOTH.
   */
  get webSocketConnected(): boolean {
    return this.socketOpen && this.authState === 'authenticated'
  }

  /**
   * @returns How far the current socket got through the server's gate, as a
   * clause that reads after "while".
   */
  private describeAuthStage(): string {
    if (this.authState === 'authenticated') {
      return 'connected'
    }
    if (this.authState === 'awaiting-accept') {
      return "waiting for the server to accept this device's proof of the server secret"
    }
    return this.socketOpen
      ? "waiting for the server's challenge"
      : 'still opening the connection'
  }

  /**
   * Describes, in one line and without going near the network, why this device
   * is not talking to the sync server: which server, and what the last socket
   * attempt was seen doing.
   *
   * For the HTTP half -- what that address actually answers -- see
   * {@link diagnoseConnectionFailure}. This one is what the log event says,
   * so it has to be available the moment the failure is noticed.
   * @returns The one-line failure description.
   */
  describeConnectionFailure(): string {
    const detail =
      this.lastSocketFailure ?? `the socket is ${this.describeAuthStage()}`
    return `Failed to connect to sync backend at ${this.serverUrl}: ${detail}`
  }

  /**
   * Describes why this device is not talking to the sync server, including what
   * a plain HTTP request to the same address answers.
   *
   * The WebSocket api is why the second half has to be asked for separately. A
   * handshake that fails arrives as an `error` event with no error in it and a
   * 1006 close with no reason -- specified that way so a page cannot use a
   * socket to probe the network -- so "it did not connect" is genuinely all the
   * socket knows. A fetch of the same address is not bound by that, and
   * separates the cases a user has to tell apart: nothing listening, no such
   * host, a certificate that is not trusted, or something listening that is not
   * a sync server (and then its status and the start of its body).
   * @returns A promise for the full failure description, on one line.
   */
  async diagnoseConnectionFailure(): Promise<string> {
    return `${this.describeConnectionFailure()}. ${await this.probeServerUrlOverHttp()}`
  }

  /**
   * Asks the sync server's address for an ordinary HTTP response.
   *
   * A sync server answers a plain GET with 426 Upgrade Required, so a 426 means
   * the address is right and the problem is the handshake or the secret;
   * anything else names what is there instead.
   * @returns A promise for a description of the response, or of the failure to
   * get one.
   */
  private async probeServerUrlOverHttp(): Promise<string> {
    const fetchImpl = globalThis.fetch as typeof globalThis.fetch | undefined
    if (!fetchImpl) {
      return 'This runtime has no fetch, so the address was not probed over HTTP'
    }

    let httpUrl: string
    try {
      const url = new URL(this.serverUrl)
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
      httpUrl = url.toString()
    } catch {
      return `${this.serverUrl} is not a valid URL`
    }

    try {
      const response = await fetchImpl(httpUrl, {
        method: 'GET',
        // Long enough for a slow server, short enough that a diagnosis is
        // still a diagnosis and not another hang.
        signal: AbortSignal.timeout(HTTP_PROBE_TIMEOUT_MS),
      })
      const body = await response
        .text()
        .then((text) => text.replace(/\s+/g, ' ').trim().slice(0, 200))
        .catch(() => '')
      const statusText = response.statusText ? ` ${response.statusText}` : ''
      return (
        `GET ${httpUrl} answered HTTP ${response.status}${statusText}` +
        (body ? `: "${body}"` : '') +
        (response.status === HTTP_UPGRADE_REQUIRED
          ? // What a sync server answers a plain request with, so this one is
            // the reachable case: something is there and speaks the protocol.
            '. The address is reachable and it is the WebSocket handshake or ' +
            'the server secret that failed'
          : '')
      )
    } catch (err) {
      return `GET ${httpUrl} failed: ${describeFetchFailure(err)}`
    }
  }

  private sendToServer<T extends ClientMessage['type']>(
    type: T,
    data: Extract<ClientMessage, { type: T }>['data'],
  ) {
    // Deliberately the socket-level check, not webSocketConnected: the proof
    // that makes that one true has to travel through here first.
    if (!this.ws || !this.socketOpen) {
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
      // The event carries no error worth reporting: browsers specify it away,
      // and Node's WebSocket hands over a TypeError with an empty message. All
      // the detail there is to have comes from asking over HTTP instead, which
      // describeConnectionFailure does.
      syncManager.lastSocketFailure = `the socket reported an error while ${syncManager.describeAuthStage()}`
      syncManager.log(
        'warning',
        `Error in websocket to ${syncManager.serverUrl}.`,
      )
    })

    ws.addEventListener('message', function message(message: MessageEvent) {
      try {
        const jsonString = String(message.data)
        const parsedMessage = JSON.parse(jsonString) as ServerMessage

        syncManager.handleServerMessage(parsedMessage)
      } catch (error) {
        // A SyncError from handleServerMessage is a REFUSAL, not a parse
        // failure, and is reported as itself. Flattening the two used to reach
        // the user as "Failed to parse message" even for the loudest alarm in
        // the sync path -- "got vault data while no resilver was requested,
        // probably replay attack!".
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

    this.authState = 'awaiting-challenge'
    ws.addEventListener('open', () => {
      // An open socket is no longer a usable one: the server speaks first with
      // a nonce this device must answer before it may say anything, so
      // everything that used to happen here -- announcing the deviceId,
      // reporting CONNECTED, draining the offline queue -- now happens in the
      // `authAccepted` case below.
      this.log('info', 'Socket open, awaiting sync server challenge.')
    })
    ws.addEventListener('close', this.handleWebSocketClose.bind(this))

    this.ws = ws
  }
  private handleWebSocketClose(event: CloseEvent) {
    this.finishInitiatorFlow({
      status: 'failed',
      reason: 'Connection lost during pairing. Run pairing again.',
    })
    if (this.shouldReconnect) {
      // Only an unexpected close says anything about why this device is not
      // connected. closeServerConnection clears shouldReconnect before it
      // closes, and recording that would overwrite the real failure with our
      // own hang-up.
      this.lastSocketFailure =
        `the socket closed with code ${event.code}` +
        (event.reason ? ` (${event.reason})` : '') +
        ` while ${this.describeAuthStage()}`
    }

    if (event.code === SYNC_SERVER_UNAUTHORIZED_CLOSE_CODE) {
      // Terminal, where every other close is temporary. The server refused this
      // socket because it could not prove the shared secret, and reconnecting
      // every five seconds would neither fix that nor let anyone notice it -- it
      // would bury the one message that says what is wrong under a loop. The
      // way out is setSyncServerUrl with a secret that works.
      this.shouldReconnect = false
      this.log(
        'error',
        `The sync server at ${this.serverUrl} refused this connection: the ` +
          'server secret is wrong or the server has changed it. Set the sync ' +
          'server again.',
      )
      this.dispatchLibEvent(FavaLibEvent.ConnectionToSyncServerStatusChanged, {
        newStatus: ConnectionStatus.FAILED,
      })
      if (this.terminateTimeout) {
        clearTimeout(this.terminateTimeout)
      }
      return
    }

    if (this.shouldReconnect) {
      this.dispatchLibEvent(FavaLibEvent.ConnectionToSyncServerStatusChanged, {
        newStatus: ConnectionStatus.CONNECTING,
      })

      // if we shouldn't reconnect, this closing is expected
      this.log(
        'warning',
        `WebSocket to ${this.serverUrl} closed: ${event.code} ${event.reason}`,
      )
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
      case 'authChallenge': {
        // Answered whatever this device thinks its state is. A server that
        // challenges twice on one socket is not a case worth branching on: the
        // proof is a function of the nonce and says nothing else, so answering
        // a second one costs an HMAC and leaks nothing.
        const { nonce } = message.data
        if (typeof nonce !== 'string' || !nonce) {
          throw new SyncError('Sync server sent a malformed challenge')
        }
        this.authState = 'awaiting-accept'
        this.sendToServer('authProof', {
          proof: createConnectProof(this.serverSecret, nonce),
        })
        break
      }
      case 'authAccepted': {
        // Everything the 'open' handler used to do, moved behind the proof: the
        // deviceId is announced, the connection is reported, and the offline
        // queue is drained, in that order and not before.
        this.authState = 'authenticated'
        this.log('info', 'Connected to server.')
        this.sendToServer('connect', { deviceId: this.deviceId })
        this.dispatchLibEvent(
          FavaLibEvent.ConnectionToSyncServerStatusChanged,
          { newStatus: ConnectionStatus.CONNECTED },
        )

        clearTimeout(this.connectionFailedTimeout)
        this.connectionFailedTimeout = undefined

        // send any commands that were done while offline
        this.processCommandSendQueue()
        break
      }
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
        const flow = this.activeAddDeviceFlow
        const { data } = message

        const unconvertedPass2Result = data.pass2Result
        const pass2Result = {
          round1Result: jsonToUint8Array(unconvertedPass2Result.round1Result),
          round2Result: jsonToUint8Array(unconvertedPass2Result.round2Result),
        } as unknown as Pass2Result

        void this.finishAddDeviceFlowKeyExchangeInitiator(
          pass2Result,
          data.responderDeviceId,
        ).catch((err: unknown) => this.failInitiatorFlow(err, flow))
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
        const flow = this.activeAddDeviceFlow
        const { data } = message
        const { responderEncryptedPublicKeys, responderEncryptedDeviceInfo } =
          data

        void this.sendFullVaultDataAndSetDeviceInfo(
          responderEncryptedPublicKeys,
          responderEncryptedDeviceInfo,
        ).catch((err: unknown) => this.failInitiatorFlow(err, flow))
        break
      }
      case 'addSyncDeviceCancelled': {
        this.finishInitiatorFlow({
          status: 'cancelled',
          reason: 'Pairing cancelled by the other device.',
        })
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
          // Neither is awaited by anything, so without a catch a refused import
          // is an unhandled rejection rather than something the consumer can
          // surface.
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
        void this.receiveCommands(commands).catch((err: unknown) => {
          // The message listener's synchronous catch cannot see this rejection.
          // Keep the server's rows for redelivery if replay-state saving failed.
          // eslint-disable-next-line no-restricted-globals
          const detail = err instanceof Error ? err.message : 'unknown error'
          this.log('error', `Could not process remote commands: ${detail}`)
        })
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

    const ws = this.ws
    const addDevicePassword = deriveSFromPassword(
      uint8ArrayToBase64(await this.cryptoLib.getRandomBytes(60)),
    )
    // A caller can cancel while the crypto provider is still producing bytes.
    if (this.ws !== ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }
    if (this.activeAddDeviceFlow) {
      throw new SyncAddDeviceFlowConflictError()
    }
    const timestamp = Date.now()

    const jpak = new JPakeThreePass(this.deviceId)
    const pass1Result = jpak.pass1()

    const continuePromise = new Promise((resolve, reject) => {
      // Set a timeout for if we get no response from the server
      const timeout = setTimeout(() => {
        if (this.activeAddDeviceFlow?.state === 'initiator:initiated') {
          this.finishInitiatorFlow({
            status: 'failed',
            reason: 'Timeout of registerAddDeviceFlowRequest, no response',
          })
        }
      }, 10000)

      this.activeAddDeviceFlow = {
        state: 'initiator:initiated',
        jpak,
        addDevicePassword,
        initiatorDeviceId: this.deviceId,
        timestamp,
        resolveContinuePromise: resolve,
        rejectContinuePromise: reject,
        timeout,
      }
    })

    // register this add device request at the server
    try {
      this.sendToServer('addSyncDeviceInitialiseData', {
        initiatorDeviceId: this.deviceId,
        timestamp,
      })
    } catch (err) {
      this.failInitiatorFlow(err, this.activeAddDeviceFlow)
    }

    // wait for the server to confirm it has registered the add device request
    await continuePromise
    if (!this.activeAddDeviceFlow) {
      throw new SyncError('Pairing ended before the connection code was ready.')
    }

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

    const flow = this.activeAddDeviceFlow
    const pass3Result = flow.jpak.pass3(
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
      responderDeviceId,
    )
    if (this.activeAddDeviceFlow !== flow) return
    this.activeAddDeviceFlow = {
      ...flow,
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
      this.activeAddDeviceFlow.responderDeviceId,
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

    const flow = this.activeAddDeviceFlow
    const syncKey = flow.syncKey
    const handshakeAad = buildHandshakeAad(
      flow.initiatorDeviceId,
      flow.responderDeviceId,
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
    if (this.activeAddDeviceFlow !== flow) return

    // get the vault data (encrypted with the sync key)
    const encryptedVaultData =
      await this.persistentStorageManager.getEncryptedVaultState(
        syncKey,
        flow.responderDeviceId,
        buildVaultDataAad(this.deviceId, flow.responderDeviceId),
      )
    if (this.activeAddDeviceFlow !== flow) return

    // Send the encrypted vault data to the server. No signature: it is
    // encrypted under the JPAKE-derived sync key, which only a party that knew
    // the out-of-band secret can hold. See importInitialVault.
    this.sendToServer('initialVault', {
      encryptedVaultData,
      initiatorDeviceId: flow.initiatorDeviceId,
    })

    // save the added the sync device, done via command so this is synced to all sync devices
    const command = AddSyncDeviceCommand.create({
      deviceId: flow.responderDeviceId,
      publicKey: decryptedPublicKeys.publicKey,
      signingPublicKey: decryptedPublicKeys.signingPublicKey,
      deviceInfo: responderDeviceInfo,
    })
    await this.commandManager.execute(command)

    if (this.activeAddDeviceFlow === flow) {
      this.finishInitiatorFlow({
        status: 'completed',
        deviceId: flow.responderDeviceId,
      })
    }
  }

  /**
   * Settles one sender flow, including a pending registration promise.
   * @param result - Its terminal outcome.
   */
  private finishInitiatorFlow(result: AddDeviceFlowResult) {
    const flow = this.activeAddDeviceFlow
    if (!flow || !('rejectContinuePromise' in flow)) return
    clearTimeout(flow.timeout)
    this.activeAddDeviceFlow = undefined
    if (result.status !== 'completed') {
      flow.rejectContinuePromise(new SyncError(result.reason))
    }
    this.dispatchLibEvent(FavaLibEvent.AddDeviceFlowFinished, result)
  }

  /**
   * Handles an asynchronous sender failure without ending a newer flow.
   * @param err - The rejected operation's error.
   * @param flow - The flow the operation belonged to.
   */
  private failInitiatorFlow(
    err: unknown,
    flow: ActiveAddDeviceFlow | undefined,
  ) {
    if (this.activeAddDeviceFlow !== flow) return
    // eslint-disable-next-line no-restricted-globals
    const reason = err instanceof Error ? err.message : 'Pairing failed.'
    this.finishInitiatorFlow({ status: 'failed', reason })
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
      true,
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

  /**
   * Decrypts a peer's whole vault state and merges it into this one.
   * @param encryptedVaultState - The sealed vault state.
   * @param symmetricKey - The key it is sealed under.
   * @param expectedDeviceId - The sender, as the caller established it.
   * @param isPairing - True when this is the initial vault of a JPAKE flow this
   * device just completed. It changes what the SENDER's own record counts as:
   * a pairing, since the user was standing in front of both devices. Every
   * other device in the list is a peer introduction either way -- the sender
   * vouching for devices this vault has never met is delegation, not pairing,
   * however the sender itself arrived.
   *
   * It also silences the announcement for the rest of the list, which is a
   * separate question from what the record says. A resilver announcing a device
   * is a peer adding one to a vault that already existed; the initial import
   * announcing one is a vault being described for the first time, which is not
   * an event -- the user chose to join it, list and all. The records are
   * identical either way, `via: 'peer'` and `by: <sender>`, so a later audit
   * still sees delegation.
   */
  private async importVaultState(
    encryptedVaultState: EncryptedVaultStateString,
    symmetricKey: SymmetricKey,
    expectedDeviceId: DeviceId,
    isPairing = false,
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
      // A device list replays in full on every resilver, so most of these are
      // already held and return without doing anything. The ones that are not
      // are what this loop is: a peer telling us devices exist.
      //
      // Refusals here are per device and non-fatal, unlike the validation
      // above. A peer listing one device whose keys contradict ours, or one we
      // revoked, must not cost us the entries in the same vault state -- and
      // both refusals have already been logged by the time they reach here.
      try {
        await this.addSyncDevice(device, {
          via:
            isPairing && device.deviceId === expectedDeviceId
              ? 'pairing'
              : 'peer',
          by: expectedDeviceId,
          saveAfter: false,
          // One expression for the whole list: the sender's own record is
          // 'pairing' and was never announced anyway.
          announce: !isPairing,
        })
      } catch (err: unknown) {
        if (
          !(err instanceof SyncDeviceRemovedError) &&
          !(err instanceof SyncDeviceKeyConflictError)
        ) {
          throw err
        }
      }
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
    if ('rejectContinuePromise' in this.activeAddDeviceFlow) {
      this.finishInitiatorFlow({
        status: 'cancelled',
        reason: 'Pairing cancelled.',
      })
      return
    }
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
        // INSIDE now -- stripping it here and taking it from the server's
        // envelope on the other side made the dedup key something the server
        // chose.
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
   * Classifies an authenticated command against the persisted replay record.
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
   * @returns Whether to execute, acknowledge a duplicate, or discard old data.
   */
  private getReplayStatus(
    from: DeviceId,
    command: SyncCommand,
  ): 'new' | 'duplicate' | 'below-floor' {
    if (this.processedCommands.some((seen) => seen.id === command.id)) {
      return 'duplicate'
    }
    const floor = this.replayFloors[from]
    if (floor !== undefined && (command.timestamp ?? 0) <= floor) {
      return 'below-floor'
    }
    return 'new'
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
   * @param applied - Every command successfully applied in this batch.
   */
  private async recordProcessedCommands(
    applied: Iterable<ProcessedCommand>,
  ): Promise<void> {
    for (const record of applied) {
      this.processedCommands.push(record)
      this.replayStateDirty = true
    }
    if (!this.replayStateDirty) {
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
    this.replayStateDirty = false
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
   * The signature is the whole point. Sealing is a public operation, so before
   * this check anyone holding a device's public key could mint commands for it.
   * Now a command is acted on only if a device CURRENTLY in this vault's peer
   * list signed it, for this recipient, under this command id -- which is also
   * what makes `removeSyncDevice` a revocation rather than bookkeeping.
   * @param commandId - The id the server delivered the command under.
   * @param envelope - The decrypted envelope, which may be anything at all.
   * @returns The command and the peer identity used for verification.
   * @throws {SyncError} If the envelope is not a command from a known peer.
   */
  private async verifyCommandEnvelope(
    commandId: string,
    envelope: Partial<SignedCommandEnvelope>,
  ): Promise<{
    command: SyncCommand
    from: DeviceId
    signingPublicKey: SigningPublicKey
  }> {
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

    const signingPublicKey = sender.signingPublicKey
    const signatureIsValid = await this.cryptoLib.verify(
      signingPublicKey,
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
    if (typeof command?.id !== 'string' || command.id !== commandId) {
      throw new SyncError('Command id does not match its envelope')
    }

    return { command, from, signingPublicKey }
  }

  /**
   * Receives commands in batch arrival order, without overlapping execution.
   * @param encryptedCommands - The commands.
   * @returns A promise resolving after the batch is processed and saved.
   * @throws {Error} If the replay state cannot be saved.
   */
  async receiveCommands(encryptedCommands: SyncCommandFromServer[]) {
    const received = this.commandReceiveQueue.then(() =>
      this.processReceivedCommands(encryptedCommands),
    )
    // A failed batch must reject its caller without poisoning later deliveries.
    this.commandReceiveQueue = received.catch(() => undefined)
    return received
  }

  /**
   * Logs the same refusal for all malformed or unauthenticated commands.
   * @param commandId - The id supplied by the server.
   */
  private reportRejectedCommand(commandId: string): void {
    this.log(
      'warning',
      `Dropping remote command ${commandId}: it could not be decrypted, ` +
        `was not authentic, or was malformed. It will be retried if the ` +
        `sending device is still on a compatible version.`,
    )
  }

  /**
   * Processes one batch, authenticating against the peer list at execution time.
   * @param encryptedCommands - The commands in this batch.
   */
  private async processReceivedCommands(
    encryptedCommands: SyncCommandFromServer[],
  ): Promise<void> {
    const decrypted = await Promise.all(
      encryptedCommands.map(async (data) => {
        try {
          const symmetricKey = await this.cryptoLib.decrypt(
            this.secretKeys.privateKey,
            data.encryptedSymmetricKey,
          )

          const envelope = JSON.parse(
            await this.cryptoLib.decryptSymmetric(
              symmetricKey,
              data.encryptedCommand,
              buildCommandAad(data.commandId, this.deviceId),
            ),
          ) as Partial<SignedCommandEnvelope> | null
          if (typeof envelope?.payload !== 'string') {
            throw new SyncError('Missing command payload')
          }
          const command = JSON.parse(envelope.payload) as SyncCommand | null
          if (
            !command ||
            typeof command !== 'object' ||
            Array.isArray(command) ||
            (command.timestamp !== undefined &&
              !Number.isFinite(command.timestamp))
          ) {
            throw new SyncError('Invalid command timestamp or payload')
          }

          // Only use this unauthenticated parse to order the batch. In
          // particular, an unknown sender may be enrolled by an earlier command.
          return {
            commandId: data.commandId,
            envelope,
            timestamp: command.timestamp ?? 0,
          }
        } catch {
          this.reportRejectedCommand(data.commandId)
          return undefined
        }
      }),
    )

    const ordered = decrypted
      .filter((command) => command !== undefined)
      .sort((a, b) => a.timestamp - b.timestamp)
    const applied = new Map<string, ProcessedCommand>()
    const acknowledgedIds = new Set<string>()

    for (const pending of ordered) {
      try {
        const { command, from, signingPublicKey } =
          await this.verifyCommandEnvelope(pending.commandId, pending.envelope)

        // Verification yields. A local removal or key replacement during it
        // must take effect before we enqueue and synchronously start executing.
        if (
          !this.syncDevices.some(
            (device) =>
              device.deviceId === from &&
              device.deviceId !== this.deviceId &&
              device.signingPublicKey === signingPublicKey,
          )
        ) {
          throw new SyncError('Command sender is no longer a peer')
        }

        const replayStatus = applied.has(command.id)
          ? 'duplicate'
          : this.getReplayStatus(from, command)
        if (replayStatus !== 'new') {
          acknowledgedIds.add(command.id)
          if (replayStatus === 'below-floor') {
            this.log(
              'warning',
              `Discarding remote command ${command.id}: it is at or below ` +
                `this peer's replay floor and will not be applied.`,
            )
          }
          continue
        }

        this.commandManager.receiveRemoteCommand(command, from)
        const executedIds = await this.commandManager.processRemoteCommands()
        if (executedIds.includes(command.id)) {
          applied.set(command.id, {
            id: command.id,
            from,
            timestamp: pending.timestamp,
          })
          acknowledgedIds.add(command.id)
        }
      } catch {
        this.reportRejectedCommand(pending.commandId)
      }
    }

    // Keep every successful origin until it is recorded. Prune only after the
    // batch, so raising a floor cannot suppress its remaining equal timestamps.
    // This also retries a previous failed save even for a duplicate-only batch.
    await this.recordProcessedCommands(applied.values())

    // if this was the first time we received commands,
    // we can signal that we're done loading after the commands where processed
    if (!this.readyEventEmitted) {
      this.readyEventEmitted = true
      this.dispatchLibEvent(FavaLibEvent.Ready)
    }

    if (acknowledgedIds.size > 0) {
      this.sendToServer('syncCommandsExecuted', {
        commandIds: [...acknowledgedIds],
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
   * Reports a device that describes itself with text that must not be printed.
   *
   * Every field here is chosen by the device being described and is only
   * length-checked, so this is the one place that can say a peer sent an
   * escape sequence, a carriage return or a bidirectional override -- the
   * three things that rewrite or reorder what a user is reading, including the
   * fingerprint they are being asked to compare it against. `deviceLabel`
   * removes them from anything shown, which is exactly why the removal has to
   * be said out loud somewhere: otherwise the tidied-up version is all anyone
   * ever sees.
   *
   * Named by fingerprint rather than by anything it claims, for the obvious
   * reason.
   * @param device - The device, already past `validateSyncDevice`.
   */
  private reportUnsafeDeviceText(device: SyncDevice) {
    const unsafe = [
      device.deviceId,
      device.deviceInfo?.deviceType,
      device.deviceInfo?.deviceFriendlyName,
    ].some((value) => value !== undefined && containsUnsafeText(value))
    if (!unsafe) {
      return
    }
    this.log(
      'error',
      `Sync device ${deviceFingerprint(device)} describes itself using ` +
        `characters that cannot safely be printed, and they have been ` +
        `removed from anything this vault shows. A device id, type and name ` +
        `are chosen by that device, so this is something it did.`,
    )
  }

  /**
   * Adds a device to this vault's peer list.
   *
   * The single chokepoint for every route a peer device can arrive by:
   * `importVaultState`, `AddSyncDeviceCommand`, and this device's own
   * registration from the constructor. The load path is the one exception --
   * it assigns `syncDevices` directly, so `creationUtils` runs the same checks
   * itself.
   *
   * Four gates, in order, and the order is the point: a record has to be
   * well formed before its id means anything, its id has to be one this vault
   * has not revoked before its keys are worth comparing, and the keys have to
   * match any it already holds before it is worth counting against the cap.
   *
   * 1. **Shape.** Unchanged, and still only a shape gate: a well formed record
   *    carrying an attacker's keys passes it.
   * 2. **Tombstone.** A device this vault removed cannot be introduced back by
   *    a peer -- that is what makes a removal stick, given that a peer offline
   *    at the time still lists it and will resilver it back. Pairing clears the
   *    tombstone instead, because that is the user saying so at both ends.
   * 3. **Key pinning.** Keys are fixed on first receipt. A second record for a
   *    known id carrying different keys is refused loudly rather than dropped:
   *    it is the only refusal here that is evidence of something rather than of
   *    a peer on a different build.
   * 4. **Cap.** As before.
   *
   * What it deliberately does NOT do is refuse a device merely because a peer
   * rather than the user introduced it. A peer holds every seed already, so
   * peer trust is flat by design; instead this records WHO introduced it and
   * announces it, so delegated trust is at least visible -- except for the one
   * list a user cannot sensibly be asked about device by device, the vault they
   * just paired into. See `announce`.
   * @param device - The device to add. Only its four wire fields are read; any
   * `enrolment` or `acknowledgedAt` on it is ignored, since those are this
   * device's opinion and a peer does not get to write them.
   * @param options - How the device arrived and what to do about it.
   * @throws {SyncError} If the record is unusable or the vault is full.
   * @throws {SyncDeviceRemovedError} If a peer is reintroducing a removed device.
   * @throws {SyncDeviceKeyConflictError} If it contradicts keys already held.
   */
  async addSyncDevice(device: SyncDevice, options: AddSyncDeviceOptions) {
    const { via, by, saveAfter = true, announce = true } = options
    const reason = validateSyncDevice(device)
    if (reason) {
      throw new SyncError(`Refusing to add sync device: ${reason}`)
    }

    if (via === 'peer' && device.deviceId in this.removedDevices) {
      this.log(
        'error',
        `Refusing to add sync device ${device.deviceId}: it was removed from ` +
          `this vault, and a peer cannot undo that. Pair with it again if you ` +
          `want it back.`,
      )
      throw new SyncDeviceRemovedError(
        `Refusing to add sync device ${device.deviceId}: it was removed from ` +
          `this vault`,
      )
    }

    const existing = this.syncDevices.find(
      (d) => d.deviceId === device.deviceId,
    )
    if (existing) {
      if (
        existing.publicKey === device.publicKey &&
        existing.signingPublicKey === device.signingPublicKey
      ) {
        // Same device saying the same thing. Idempotent by design: every
        // resilver replays the whole device list.
        return
      }
      if (via === 'self') {
        // Only the constructor passes 'self', always with this device's own
        // keys, so there is no peer-reachable path to this branch. Updating
        // rather than refusing keeps a key change made HERE from bricking this
        // device's own record in its own vault.
        existing.publicKey = device.publicKey
        existing.signingPublicKey = device.signingPublicKey
        existing.deviceInfo = device.deviceInfo
        this.dispatchLibEvent(FavaLibEvent.Changed)
        if (saveAfter) {
          await this.persistentStorageManager.save()
        }
        return
      }
      this.log(
        'error',
        `Refusing to add sync device ${device.deviceId}: this vault already ` +
          `holds different keys for that device id. Keys are pinned on first ` +
          `receipt and never replaced; if that device really did change keys, ` +
          `remove it and pair with it again.`,
      )
      throw new SyncDeviceKeyConflictError(
        `Refusing to add sync device ${device.deviceId}: it contradicts the ` +
          `keys this vault already holds for that device id`,
      )
    }

    // Below the idempotent early return above, and deliberately: a device list
    // replays in full on every resilver, so reporting here rather than at the
    // top of the method is the difference between saying this once and saying
    // it every few seconds for as long as that peer stays connected. The two
    // refusals above are already logged loudly on their own.
    this.reportUnsafeDeviceText(device)

    if (this.syncDevices.length >= MAX_SYNC_DEVICES) {
      throw new SyncError(
        `Refusing to add sync device ${device.deviceId}: this vault already ` +
          `has the maximum of ${MAX_SYNC_DEVICES} devices`,
      )
    }

    const at = Date.now()
    // One condition for both halves of "this needs surfacing": the
    // acknowledgement flag exists to tell a consumer what it has not shown yet,
    // so it has to agree exactly with whether anything was announced.
    const announceToUser = via === 'peer' && announce
    // Built field by field rather than spread, so that a record arriving from a
    // peer cannot carry its own provenance or pre-acknowledge itself.
    const enrolled: SyncDevice = {
      deviceId: device.deviceId,
      publicKey: device.publicKey,
      signingPublicKey: device.signingPublicKey,
      deviceInfo: device.deviceInfo,
      enrolment: { via, by: via === 'peer' ? by : undefined, at },
      // Anything but a peer introduction is an act the user performed in
      // person at both ends; asking them to confirm it afterwards would be
      // noise, and noise is what stops the one that matters being read. So is
      // the initial pairing import: the user chose to join that vault, list and
      // all, so its contents are the baseline rather than news.
      acknowledgedAt: announceToUser ? undefined : at,
    }
    // Cleared here rather than up with the tombstone check, so that a pairing
    // refused further down -- by the cap, or by a key conflict -- does not
    // leave the device un-listed AND un-tombstoned, which is the one state in
    // which a peer could introduce it.
    //
    // Re-pairing is how a removal is undone, and the only how: it costs the
    // 60-byte out-of-band secret and a user standing in front of both devices,
    // which is exactly the act the tombstone exists to protect.
    if (via === 'pairing') {
      delete this.removedDevices[device.deviceId]
    }
    this.log('info', `Adding syncdevice ${device.deviceId} to ${this.deviceId}`)
    this.syncDevices.push(enrolled)
    // The device list is vault state like any other, and `Changed` is the only
    // event a consumer can re-read it on. `SyncDeviceAdded` below is narrower
    // -- peer introductions only, and informational -- so it is not a
    // substitute for this: without it a device added by pairing, or by a peer,
    // shows up in a list only once something unrelated changes an entry.
    this.dispatchLibEvent(FavaLibEvent.Changed)

    if (announceToUser) {
      const fingerprint = deviceFingerprint(enrolled)
      // `by` is a verified deviceId, but its NAME has to be looked up: a peer's
      // own description of itself is the only place one exists. Falling back to
      // the bare id keeps this honest if the introducer is somehow not listed.
      const introducer = this.syncDevices.find((d) => d.deviceId === by)
      const byLabel = by
        ? deviceLabel(introducer ?? { deviceId: by })
        : 'A peer'
      // 'warning', not 'error': Events.mts reserves 'error' for a REFUSAL the
      // user should be told about, and nothing was refused here -- under flat
      // peer trust this is an ordinary thing that happened. It is logged at all
      // so that a consumer with no SyncDeviceAdded listener still surfaces it.
      this.log(
        'warning',
        `${byLabel} added sync device ${deviceLabel(enrolled)} to this vault, ` +
          `fingerprint ${fingerprint}. Device names are chosen by the device ` +
          `itself and are not checked by anything, so compare the fingerprint ` +
          `rather than the name. If you did not expect that, remove it.`,
      )
      this.dispatchLibEvent(FavaLibEvent.SyncDeviceAdded, {
        deviceId: enrolled.deviceId,
        fingerprint,
        deviceInfo: enrolled.deviceInfo,
        enrolment: enrolled.enrolment!,
      })
    }

    if (saveAfter) {
      await this.persistentStorageManager.save()
    }
  }

  /**
   * Records that a consumer has surfaced a peer-introduced device to the user.
   *
   * Local and terminal: no command is sent, no peer is told, and nothing about
   * the device changes. It exists so a consumer that was not running when
   * `SyncDeviceAdded` fired can still find what it has not shown yet, by
   * filtering `getSyncDevices()` on `acknowledged`.
   * @param deviceId - The device that has been surfaced.
   * @param saveAfter - Whether to save afterwards.
   */
  async acknowledgeSyncDevice(deviceId: DeviceId, saveAfter = true) {
    const device = this.syncDevices.find((d) => d.deviceId === deviceId)
    if (!device || device.acknowledgedAt !== undefined) {
      return
    }
    device.acknowledgedAt = Date.now()
    // `acknowledged` is part of what getSyncDevices reports, so this is a
    // change to the list even though nothing about the device itself moved.
    this.dispatchLibEvent(FavaLibEvent.Changed)
    if (saveAfter) {
      await this.persistentStorageManager.save()
    }
  }

  /**
   * Records what a device now says about itself.
   *
   * The write half of a rename; who may rename whom is decided in
   * `ChangeDeviceInfoCommand.validate`, both for the local route and for a
   * peer's. It lives here rather than in that command so that every mutation
   * of the device list is in one place with its `Changed` dispatch -- a rename
   * applied straight to `syncDevices` left every list built on that event
   * showing the old name.
   *
   * Does not save: the command that calls it does, together with the rest of
   * what it changed.
   * @param deviceId - The device being renamed.
   * @param deviceInfo - What it now says about itself.
   * @returns Whether a device with that id was in the list.
   */
  setDeviceInfo(deviceId: DeviceId, deviceInfo: DeviceInfo): boolean {
    const device = this.syncDevices.find((d) => d.deviceId === deviceId)
    if (!device) {
      return false
    }
    // A rename is the second way a device gets to describe itself, so it needs
    // the same report as enrolment -- checked against the new description, on
    // the record whose keys the fingerprint comes from.
    this.reportUnsafeDeviceText({ ...device, deviceInfo })
    device.deviceInfo = deviceInfo
    this.dispatchLibEvent(FavaLibEvent.Changed)
    return true
  }

  /**
   * Removes a device from this vault's peer list, and remembers that it did.
   *
   * The tombstone is the half that makes this a revocation rather than a
   * deletion. Without it, a peer that was offline when the removal happened
   * still lists the device, and its next resilver puts it straight back through
   * `importVaultState` -- at which point its commands verify again and the one
   * lever the user has has quietly done nothing.
   * @param deviceId - The id of the device to remove.
   * @param saveAfter - Whether to save the vault after removing the device.
   * @returns The removed device, or undefined if it was not present.
   * @throws {SyncError} If asked to remove this device from its own vault.
   */
  async removeSyncDevice(
    deviceId: DeviceId,
    saveAfter = true,
  ): Promise<SyncDevice | undefined> {
    if (deviceId === this.deviceId) {
      // FavaLib.removeSyncDevice refuses this too, but only covers the local
      // route. A peer's RemoveSyncDeviceCommand reaches here directly, and this
      // device's own record is what a NEWLY PAIRED device learns its keys from
      // (see importInitialVault) -- so losing it presents, much later, as
      // "pairing is broken" rather than as anything to do with the removal.
      throw new SyncError('Cannot remove the current device from its own vault')
    }
    const index = this.syncDevices.findIndex((d) => d.deviceId === deviceId)
    if (index === -1) {
      // We don't have this device, so nothing to remove -- and deliberately no
      // tombstone either, or a peer could inflate the record with removals for
      // ids this vault never held.
      return undefined
    }
    this.log('info', `Removing syncdevice ${deviceId} from ${this.deviceId}`)
    const [removed] = this.syncDevices.splice(index, 1)
    this.removedDevices[deviceId] = Date.now()
    this.pruneRemovedDevices()
    this.dispatchLibEvent(FavaLibEvent.Changed)

    if (saveAfter) {
      await this.persistentStorageManager.save()
    }

    return removed
  }

  /**
   * Keeps the tombstone record inside its bound, oldest removals first.
   *
   * Pruning here WEAKENS the record -- a forgotten tombstone is a device a peer
   * may introduce again -- which is why this is loud and why the bound is loose.
   * There is no equivalent of `15`'s replay floors available: device ids are not
   * ordered, so a dropped entry leaves nothing behind that still refuses.
   */
  private pruneRemovedDevices() {
    const entries = Object.entries(this.removedDevices) as [DeviceId, number][]
    if (entries.length <= MAX_REMOVED_DEVICES) {
      return
    }
    entries.sort((a, b) => a[1] - b[1])
    for (const [deviceId] of entries.slice(
      0,
      entries.length - MAX_REMOVED_DEVICES,
    )) {
      delete this.removedDevices[deviceId]
      this.log(
        'warning',
        `Forgetting that sync device ${deviceId} was removed: this vault is ` +
          `at its limit of ${MAX_REMOVED_DEVICES} remembered removals. A peer ` +
          `can introduce that device again.`,
      )
    }
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
    this.finishInitiatorFlow({
      status: 'cancelled',
      reason: 'Pairing connection closed.',
    })
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
