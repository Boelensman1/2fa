import WebSocket, { MessageEvent, CloseEvent } from 'isomorphic-ws'
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
} from 'jpake'
import type ServerMessage from '2faserver/ServerMessage'
import type ClientMessage from '2faserver/ClientMessage'

import { TwoFaLibEvent } from '../TwoFaLibEvent.mjs'
import {
  ActiveAddDeviceFlow,
  InitiateAddDeviceFlowResult,
  SyncDevice,
  DeviceId,
  DeviceType,
} from '../interfaces/SyncTypes.mjs'
import { decodeInitiatorData, jsonToUint8Array } from '../utils/syncUtils.mjs'
import type {
  EncryptedPublicKey,
  PrivateKey,
  PublicKey,
  Salt,
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
  VaultState,
  EncryptedVaultStateString,
  VaultSyncStateWithServerUrl,
} from '../interfaces/Vault.mjs'
import { SyncCommandFromServer } from '2faserver/ServerMessage'
import { SyncCommandFromClient } from '2faserver/ClientMessage'

const IN_TESTING = process.env.NODE_ENV === 'test'
const IN_DEV = process.env.NODE_ENV === 'development'

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
  syncDevices: SyncDevice[]
  deviceId: DeviceId

  private readyEventEmitted = false

  private commandSendQueue: SyncCommandFromClient[] = []

  private reconnectTimeout?: NodeJS.Timeout
  private shouldReconnect = true

  /**
   * Public getter for the command send queue.
   * @returns The command send queue.
   */
  public getCommandSendQueue() {
    return this.commandSendQueue
  }

  /**
   * Creates an instance of SyncManager.
   * @param mediator - The mediator for accessing other components.
   * @param deviceType - The type of the device.
   * @param publicKey - The public key of the device.
   * @param privateKey - The private key of the device.
   * @param syncState - The state of the sync.
   * @param deviceId - The unique identifier of the device.
   * @throws {InitializationError} If initialization fails (e.g., if the server URL is invalid).
   */
  constructor(
    private readonly mediator: TwoFaLibMediator,
    private readonly deviceType: DeviceType,
    private readonly publicKey: PublicKey,
    private readonly privateKey: PrivateKey,
    syncState: VaultSyncStateWithServerUrl,
    deviceId: DeviceId,
  ) {
    const { serverUrl, devices, commandSendQueue } = syncState

    if (!serverUrl.startsWith('wss://')) {
      if (!serverUrl.startsWith('ws://') && !(IN_DEV || IN_TESTING)) {
        throw new InitializationError(
          'Invalid server URL, protocol must be wss',
        )
      }
    }
    this.deviceId = deviceId
    this.syncDevices = devices
    this.commandSendQueue = commandSendQueue
    this.serverUrl = serverUrl
    this.initServerConnection()
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
    const ws = new WebSocket(this.serverUrl)

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const syncManager = this

    ws.addEventListener('error', (event) => {
      syncManager.log('warning', `Error in websocket: ${event.error}`)
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
        connected: true,
      })

      // send any commands that were done while offline
      void this.processCommandSendQueue()
    })
    ws.addEventListener('close', this.handleWebSocketClose.bind(this))

    this.ws = ws
  }
  private handleWebSocketClose(event: CloseEvent) {
    this.dispatchLibEvent(TwoFaLibEvent.ConnectionToSyncServerStatusChanged, {
      connected: false,
    })

    if (this.shouldReconnect) {
      // if we shouldn't reconnect, this closing is expected
      this.log('warning', `WebSocket closed: ${event.code} ${event.reason}`)
      this.attemptReconnect()
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
          data.responderDeviceType,
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
      case 'publicKey': {
        const { data } = message
        const { responderEncryptedPublicKey } = data
        void this.sendInitialVaultData(
          responderEncryptedPublicKey as EncryptedPublicKey,
        )
        break
      }
      case 'vault': {
        const { data } = message
        const { encryptedVaultData, initiatorEncryptedPublicKey } = data
        void this.importInitialVaultState(
          encryptedVaultData,
          initiatorEncryptedPublicKey as EncryptedPublicKey,
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
      initiatorDeviceType: this.deviceType,
      initiatorDeviceId: this.deviceId,
      timestamp,
      nonce: await this.getNonce(),
    })

    // wait for the server to confirm it has registered the add device request
    await continuePromise

    const returnData: InitiateAddDeviceFlowResult = {
      addDevicePassword: uint8ArrayToBase64(addDevicePassword),
      initiatorDeviceId: this.deviceId,
      initiatorDeviceType: this.deviceType,
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
      const qrGeneratorLib = await this.libraryLoader.getQrGeneratorLib()
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

    const {
      addDevicePassword,
      initiatorDeviceId,
      timestamp,
      pass1Result,
      initiatorDeviceType: initiatorDeviceIdentifier,
    } = await decodeInitiatorData(
      initiatorData,
      initiatorDataType,
      await this.libraryLoader.getJsQrLib(),
      this.libraryLoader.getCanvasLib.bind(this),
    )

    if (
      !addDevicePassword ||
      !initiatorDeviceId ||
      !timestamp ||
      !pass1Result ||
      !initiatorDeviceIdentifier
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
      initiatorDeviceType: initiatorDeviceIdentifier,
      timestamp: Date.now(),
    }

    // respond to this add device request at the server
    this.sendToServer('JPAKEPass2', {
      nonce: await this.getNonce(),
      // @ts-expect-error we get a type mismatch because we input Uint8Array instead of JsonifiedUint8Array, but it will get jsonified later
      pass2Result,
      responderDeviceId: this.deviceId,
      initiatorDeviceId: initiatorDeviceId,
      responderDeviceType: this.deviceType,
    })
  }

  private async finishAddDeviceFlowKeyExchangeInitiator(
    pass2Result: Pass2Result,
    responderDeviceId: DeviceId,
    responderDeviceType: DeviceType,
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
      responderDeviceType: responderDeviceType,
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
    // send our public key
    this.sendToServer('publicKey', {
      nonce: await this.getNonce(),
      responderEncryptedPublicKey,
      initiatorDeviceId: this.activeAddDeviceFlow.initiatorDeviceId,
    })
  }

  private async sendInitialVaultData(
    responderEncryptedPublicKey: EncryptedPublicKey,
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

    // get the vault data (encrypted with the sync key)
    const encryptedVaultData =
      await this.persistentStorageManager.getEncryptedVaultState(syncKey)
    const initiatorEncryptedPublicKey = await this.cryptoLib.encryptSymmetric(
      syncKey,
      this.publicKey,
    )

    // Send the encrypted vault data to the server
    this.sendToServer('vault', {
      nonce: await this.getNonce(),
      encryptedVaultData,
      initiatorDeviceId: this.activeAddDeviceFlow.initiatorDeviceId,
      initiatorEncryptedPublicKey,
    })

    this.syncDevices.push({
      deviceId: this.activeAddDeviceFlow.responderDeviceId,
      deviceType: this.activeAddDeviceFlow.responderDeviceType,
      publicKey: decryptedPublicKey as PublicKey,
    })
    await this.persistentStorageManager.save()

    // all done
    this.activeAddDeviceFlow = undefined
  }

  private async importInitialVaultState(
    encryptedVaultState: EncryptedVaultStateString,
    encryptedPublicKey: EncryptedPublicKey,
  ) {
    if (this.activeAddDeviceFlow?.state !== 'responder:syncKeyCreated') {
      throw new SyncInWrongStateError(
        `Expected responder:syncKeyCreated, got ${this.activeAddDeviceFlow?.state}`,
      )
    }

    const syncKey = this.activeAddDeviceFlow.syncKey

    // Decrypt the received public key
    const decryptedPublicKey = await this.cryptoLib.decryptSymmetric(
      syncKey,
      encryptedPublicKey,
    )

    const vaultState = JSON.parse(
      await this.cryptoLib.decryptSymmetric(syncKey, encryptedVaultState),
    ) as VaultState

    if (vaultState.deviceId !== this.activeAddDeviceFlow.initiatorDeviceId) {
      throw new SyncError(
        `DeviceId mismatch when importing, expected ${this.activeAddDeviceFlow.initiatorDeviceId} got ${vaultState.deviceId}`,
      )
    }

    this.syncDevices = vaultState.sync.devices
    this.mediator
      .getComponent('vaultDataManager')
      .replaceVault(vaultState.vault)

    // Update the sync devices list with the initiator's information
    this.syncDevices.push({
      deviceId: this.activeAddDeviceFlow.initiatorDeviceId,
      deviceType: this.activeAddDeviceFlow.initiatorDeviceType,
      publicKey: decryptedPublicKey as PublicKey,
    })
    await this.persistentStorageManager.save()

    // Reset the active add device flow
    this.activeAddDeviceFlow = undefined
    this.dispatchLibEvent(TwoFaLibEvent.ConnectToExistingVaultFinished)
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
      setTimeout(() => ws.terminate(), 1000)
    }
  }
}

export default SyncManager
