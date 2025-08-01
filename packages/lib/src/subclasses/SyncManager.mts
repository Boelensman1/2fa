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
import type ServerMessage from 'favaserver/ServerMessage'
import type ClientMessage from 'favaserver/ClientMessage'

import { TwoFaLibEvent } from '../TwoFaLibEvent.mjs'
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
import type {
  Encrypted,
  EncryptedPublicKey,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
} from '../interfaces/CryptoLib.mjs'
import type { SyncCommand } from '../interfaces/CommandTypes.mjs'
import type Command from '../Command/BaseCommand.mjs'

import type TwoFaLibMediator from '../TwoFaLibMediator.mjs'

import {
  InitializationError,
  SyncAddDeviceFlowConflictError,
  SyncError,
  SyncInWrongStateError,
  SyncNoServerConnectionError,
  TwoFALibError,
} from '../TwoFALibError.mjs'
import {
  EncryptedVaultStateString,
  VaultSyncStateWithServerUrl,
} from '../interfaces/Vault.mjs'
import type { FavaMeta } from '../interfaces/FavaMeta.mjs'

import { SyncCommandFromServer } from 'favaserver/ServerMessage'
import { SyncCommandFromClient } from 'favaserver/ClientMessage'
import AddSyncDeviceCommand from '../Command/commands/AddSyncDeviceCommand.mjs'

const IN_TESTING = process.env.NODE_ENV === 'test'
const IN_DEV = process.env.NODE_ENV === 'development'

export enum ConnectionStatus {
  CONNECTING,
  CONNECTED,
  NOT_CONNECTED,
  FAILED,
}

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

  private reconnectTimeout?: NodeJS.Timeout
  private terminateTimeout?: NodeJS.Timeout
  private connectionFailedTimeout?: NodeJS.Timeout
  private shouldReconnect = true

  private requestedResilver = false
  private requestedResilverTimeout?: NodeJS.Timeout

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
   * @param publicKey - The public key of the device.
   * @param privateKey - The private key of the device.
   * @param favaMeta - Meta info containing at least a unique identifier for this device.
   * @param syncState - The state of the sync.
   * @param deviceType - The identifier for this device type (e.g. 2fa-cli).
   * @throws {InitializationError} If initialization fails (e.g., if the server URL is invalid).
   */
  constructor(
    private readonly mediator: TwoFaLibMediator,
    private readonly publicKey: PublicKey,
    private readonly privateKey: PrivateKey,
    private readonly favaMeta: FavaMeta,
    syncState: VaultSyncStateWithServerUrl,
    private readonly deviceType: DeviceType,
  ) {
    const { serverUrl, devices, commandSendQueue } = syncState

    if (!serverUrl.startsWith('wss://')) {
      if (!serverUrl.startsWith('ws://') && !(IN_DEV || IN_TESTING)) {
        throw new InitializationError(
          'Invalid server URL, protocol must be wss',
        )
      }
    }
    this.syncDevices = devices
    this.commandSendQueue = commandSendQueue
    this.serverUrl = serverUrl
    this.initServerConnection()

    // add ourselves to the list of syncdevices if we're missing
    void this.addSyncDevice(
      {
        deviceId: this.favaMeta.deviceId,
        publicKey: this.publicKey,
        deviceInfo: this.deviceInfo,
      },
      false,
    )

    // if not yet connected after 2 tries, emit ready event so we can continue
    this.connectionFailedTimeout = setTimeout(() => {
      if (!this.readyEventEmitted && !this.webSocketConnected) {
        this.log('warning', 'Failed to connect to sync backend')
        this.dispatchLibEvent(TwoFaLibEvent.Ready)

        this.dispatchLibEvent(
          TwoFaLibEvent.ConnectionToSyncServerStatusChanged,
          {
            newStatus: ConnectionStatus.FAILED,
          },
        )
      }
    }, this.reconnectInterval + 1000)
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

  private async getNonce() {
    return uint8ArrayToBase64(await this.cryptoLib.getRandomBytes(16))
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
        // eslint-disable-next-line no-restricted-globals
        if (error instanceof Error) {
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
      this.dispatchLibEvent(TwoFaLibEvent.ConnectionToSyncServerStatusChanged, {
        newStatus: ConnectionStatus.CONNECTED,
      })

      clearTimeout(this.connectionFailedTimeout)
      this.connectionFailedTimeout = undefined

      // send any commands that were done while offline
      void this.processCommandSendQueue()
    })
    ws.addEventListener('close', this.handleWebSocketClose.bind(this))

    this.ws = ws
  }
  private handleWebSocketClose(event: CloseEvent) {
    if (this.shouldReconnect) {
      this.dispatchLibEvent(TwoFaLibEvent.ConnectionToSyncServerStatusChanged, {
        newStatus: ConnectionStatus.CONNECTING,
      })

      // if we shouldn't reconnect, this closing is expected
      this.log('warning', `WebSocket closed: ${event.code} ${event.reason}`)
      this.attemptReconnect()
    } else {
      this.dispatchLibEvent(TwoFaLibEvent.ConnectionToSyncServerStatusChanged, {
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
        const { responderEncryptedPublicKey, responderEncryptedDeviceInfo } =
          data

        void this.sendFullVaultDataAndSetDeviceInfo(
          responderEncryptedPublicKey,
          responderEncryptedDeviceInfo,
        )
        break
      }
      case 'initialVault': {
        const { data } = message
        const { encryptedVaultData } = data
        void this.importInitialVault(encryptedVaultData)
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
        } = data

        if (forDeviceId !== this.deviceId) {
          throw new SyncError('Got vault data for the wrong device!')
        }

        void this.cryptoLib
          .decrypt(this.privateKey, encryptedSymmetricKey)
          .then((symmetricKey) =>
            this.importVaultState(
              encryptedVaultData,
              symmetricKey,
              fromDeviceId,
            ),
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
            new TwoFALibError(
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
      nonce: await this.getNonce(),
    })

    // wait for the server to confirm it has registered the add device request
    await continuePromise

    const returnData: InitiateAddDeviceFlowResult = {
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

    const { addDevicePassword, initiatorDeviceId, timestamp, pass1Result } =
      await decodeInitiatorData(
        initiatorData,
        initiatorDataType,
        await this.libraryLoader.getJsQrLib(),
        this.libraryLoader.getQrGeneratorLib(),
      )

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
      nonce: await this.getNonce(),
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
      nonce: await this.getNonce(),
      initiatorDeviceId: this.activeAddDeviceFlow.initiatorDeviceId,
      // @ts-expect-error we get a type mismatch because we input Uint8Array instead of JsonifiedUint8Array, but it will get jsonified later
      pass3Result,
    })

    const sharedKey = this.activeAddDeviceFlow.jpak.deriveSharedKey()
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

    if (!this.publicKey) {
      throw new SyncError('Public key not set')
    }

    this.activeAddDeviceFlow.jpak.receivePass3Results(pass3Result)

    const sharedKey = this.activeAddDeviceFlow.jpak.deriveSharedKey()
    const syncKey = await this.cryptoLib.createSyncKey(
      sharedKey,
      this.activeAddDeviceFlow.responderDeviceId as string as Salt,
    )
    this.activeAddDeviceFlow = {
      ...this.activeAddDeviceFlow,
      state: 'responder:syncKeyCreated',
      syncKey,
    }

    const responderEncryptedPublicKey = await this.cryptoLib.encryptSymmetric(
      syncKey,
      this.publicKey,
    )
    const responderEncryptedDeviceInfo = await this.cryptoLib.encryptSymmetric(
      syncKey,
      JSON.stringify(this.deviceInfo),
    )

    // send our public key
    this.sendToServer('publicKeyAndDeviceInfo', {
      nonce: await this.getNonce(),
      responderEncryptedPublicKey,
      responderEncryptedDeviceInfo,
      initiatorDeviceId: this.activeAddDeviceFlow.initiatorDeviceId,
    })
  }

  private async sendFullVaultDataAndSetDeviceInfo(
    responderEncryptedPublicKey: EncryptedPublicKey,
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

    if (!this.publicKey) {
      throw new SyncError('Public key not set')
    }

    const syncKey = this.activeAddDeviceFlow.syncKey

    // Decrypt the received public key
    const decryptedPublicKey = await this.cryptoLib.decryptSymmetric(
      syncKey,
      responderEncryptedPublicKey,
    )

    // decrypt the received device info
    const responderDeviceInfo = JSON.parse(
      await this.cryptoLib.decryptSymmetric(
        syncKey,
        responderEncryptedDeviceInfo,
      ),
    ) as DeviceInfo

    // get the vault data (encrypted with the sync key)
    const encryptedVaultData =
      await this.persistentStorageManager.getEncryptedVaultState(
        syncKey,
        this.activeAddDeviceFlow.responderDeviceId,
      )

    // Send the encrypted vault data to the server
    this.sendToServer('initialVault', {
      nonce: await this.getNonce(),
      encryptedVaultData,
      initiatorDeviceId: this.activeAddDeviceFlow.initiatorDeviceId,
    })

    // save the added the sync device, done via command so this is synced to all sync devices
    const command = AddSyncDeviceCommand.create({
      deviceId: this.activeAddDeviceFlow.responderDeviceId,
      publicKey: decryptedPublicKey,
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

    await this.importVaultState(
      encryptedVaultState,
      this.activeAddDeviceFlow.syncKey,
      this.activeAddDeviceFlow.initiatorDeviceId,
    )

    // Reset the active add device flow
    this.activeAddDeviceFlow = undefined
    this.dispatchLibEvent(TwoFaLibEvent.ConnectToExistingVaultFinished)
  }

  private async importVaultState(
    encryptedVaultState: EncryptedVaultStateString,
    symmetricKey: SymmetricKey,
    expectedDeviceId: DeviceId,
  ) {
    const vaultState = JSON.parse(
      await this.cryptoLib.decryptSymmetric(symmetricKey, encryptedVaultState),
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
    this.dispatchLibEvent(TwoFaLibEvent.ConnectToExistingVaultFinished)
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

        // unique symmetricKey per command
        const symmetricKey = await this.cryptoLib.createSymmetricKey()
        const encryptedSymmetricKey = await this.cryptoLib.encrypt(
          device.publicKey,
          symmetricKey,
        )
        const encryptedCommand = await this.cryptoLib.encryptSymmetric(
          symmetricKey,
          JSON.stringify({
            ...commandJson,
            id: undefined,
            padding: generateNonCryptographicRandomString(), // make it harder to guess the length
          }),
        )

        this.commandSendQueue.push({
          commandId: command.id,
          deviceId: device.deviceId,
          encryptedSymmetricKey,
          encryptedCommand,
        })
      }),
    )

    await this.processCommandSendQueue()
  }

  private async processCommandSendQueue() {
    if (this.syncDevices.length === 0) {
      // no devices to sync with, no need to send anything
      this.commandSendQueue = []
      return
    }

    if (!this.ws || !this.webSocketConnected) {
      // not possible to process commands at this point
      this.log(
        'warning',
        'Could not sync commands, no server connection, will retry later.',
      )
      return
    }

    if (this.commandSendQueue.length === 0) {
      // no commands to sync
      return
    }

    this.sendToServer('syncCommands', {
      nonce: await this.getNonce(),
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
  }

  /**
   * Receives and processes commands from other devices.
   * @param encryptedCommands - The commands
   * @throws {CryptoError} If decryption fails.
   */
  async receiveCommands(encryptedCommands: SyncCommandFromServer[]) {
    await Promise.all(
      encryptedCommands.map(async (data) => {
        const symmetricKey = await this.cryptoLib.decrypt(
          this.privateKey,
          data.encryptedSymmetricKey,
        )

        const command = JSON.parse(
          await this.cryptoLib.decryptSymmetric(
            symmetricKey,
            data.encryptedCommand,
          ),
        ) as Omit<SyncCommand, 'id'>

        this.commandManager.receiveRemoteCommand({
          ...command,
          id: data.commandId,
        } as SyncCommand)
      }),
    )

    const commandsExecutedIds =
      await this.commandManager.processRemoteCommands()

    // if this was the first time we received commands,
    // we can signal that we're done loading after the commands where processed
    if (!this.readyEventEmitted) {
      this.readyEventEmitted = true
      this.dispatchLibEvent(TwoFaLibEvent.Ready)
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
        )

      this.sendToServer('vault', {
        forDeviceId: device.deviceId,
        nonce: await this.getNonce(),
        encryptedVaultData,
        encryptedSymmetricKey,
      })
    }
  }

  /**
   * Add a sync device
   * @param device - The device to add
   * @param saveAfter - Whether to save the new vault after adding it (set to false when adding multiple devices)
   */
  async addSyncDevice(device: SyncDevice, saveAfter = true) {
    if (this.syncDevices.some((d) => d.deviceId === device.deviceId)) {
      // we already have this device
      return
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
   * Requests a resilver of the vault
   */
  async requestResilver() {
    this.sendToServer('startResilver', {
      deviceIds: this.syncDevices.map((d) => d.deviceId),
      nonce: await this.getNonce(),
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
