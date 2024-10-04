import WebSocket, { MessageEvent } from 'isomorphic-ws'
import {
  deriveSFromPassword,
  JPakeThreePass,
  Pass2Result,
  Pass3Result,
} from 'jpake'
import {
  ActiveAddDeviceFlow,
  InitiateAddDeviceFlowResult,
  SyncDevice,
  UserId,
} from '../interfaces/SyncTypes.mjs'
import { decodeInitiatorData, jsonToUint8Array } from '../utils/syncUtils.mjs'
import type {
  EncryptedPublicKey,
  EncryptedSymmetricKey,
  PrivateKey,
  PublicKey,
  SymmetricKey,
} from '../interfaces/CryptoLib.mjs'
import type Command from '../Command/BaseCommand.mjs'
import type { RemoteCommand } from '../Command/commandTypes.mjs'

import type LibraryLoader from './LibraryLoader.mjs'
import type PersistentStorageManager from './PersistentStorageManager.mjs'
import type CommandManager from './CommandManager.mjs'

// Ensure Buffer is available globally for the browser environment
import { Buffer } from 'buffer'
import {
  InitializationError,
  SyncAddDeviceFlowConflictError,
  SyncError,
  SyncInWrongStateError,
  SyncNoServerConnectionError,
} from '../TwoFALibError.mjs'
globalThis.Buffer = Buffer

function generateRandomString() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const length = Math.floor(Math.random() * 64) + 1
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join('')
}

class SyncManager {
  private ws?: WebSocket
  private activeAddDeviceFlow?: ActiveAddDeviceFlow
  syncDevices: SyncDevice[]
  userId: UserId

  constructor(
    private libraryLoader: LibraryLoader,
    private readonly commandManager: CommandManager,
    private readonly persistentStoragemanager: PersistentStorageManager,
    private readonly deviceIdentifier: string,
    private readonly publicKey: PublicKey,
    private readonly privateKey: PrivateKey,
    serverUrl: string,
    userId: UserId,
    syncDevices = [] as SyncDevice[],
  ) {
    if (!serverUrl.startsWith('ws://') && !serverUrl.startsWith('wss://')) {
      throw new InitializationError(
        'Invalid server URL, protocol must be ws or wss',
      )
    }
    this.userId = userId
    this.syncDevices = syncDevices
    this.initServerConnection(serverUrl)
  }

  private get cryptoLib() {
    return this.libraryLoader.getCryptoLib()
  }

  get inAddDeviceFlow(): boolean {
    return Boolean(this.activeAddDeviceFlow)
  }
  get webSocketConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
  get shouldSendCommands(): boolean {
    return (
      this.webSocketConnected &&
      !this.inAddDeviceFlow &&
      this.syncDevices.length > 0
    )
  }
  private async getNonce() {
    return Buffer.from(await this.cryptoLib.getRandomBytes(16)).toString(
      'base64',
    )
  }

  initServerConnection(serverUrl: string) {
    const ws = new WebSocket(serverUrl)

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const libInstance = this
    ws.addEventListener('error', console.error)

    ws.addEventListener('message', function message(message: MessageEvent) {
      try {
        const jsonString = String(message.data)
        const parsedMessage = JSON.parse(jsonString) as Record<string, unknown>

        libInstance.handleServerMessage(parsedMessage)
      } catch (error) {
        console.error('Failed to parse message:', error)
      }
    })

    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          data: {
            userId: libInstance.userId,
          },
        }),
      )
    })

    this.ws = ws
  }

  private handleServerMessage(message: Record<string, unknown>) {
    switch (message.type) {
      case 'addDeviceFlowRequestRegistered': {
        if (this.activeAddDeviceFlow?.state !== 'initiator:initiated') {
          throw new SyncInWrongStateError()
        }
        this.activeAddDeviceFlow.resolveContinuePromise(message)
        break
      }
      case 'addDevicePassPass2Result': {
        const data = message.data as Record<string, unknown>

        const unconvertedPass2Result = data.pass2Result as Record<
          string,
          Record<string, Record<string, number>>
        >
        const pass2Result = {
          round1Result: jsonToUint8Array(unconvertedPass2Result.round1Result),
          round2Result: jsonToUint8Array(unconvertedPass2Result.round2Result),
        } as unknown as Pass2Result

        void this.finishAddDeviceFlowKeyExchangeInitiator(
          pass2Result,
          data.responderUserIdString as string,
          data.responderDeviceIdentifier as string,
        )
        break
      }
      case 'addDevicePassPass3Result': {
        const data = message.data as Record<string, unknown>

        const pass3Result = jsonToUint8Array(
          (data as Record<string, Record<string, Record<string, number>>>)
            .pass3Result,
        ) as unknown as Pass3Result

        void this.finishAddDeviceFlowKeyExchangeResponder(pass3Result)
        break
      }
      case 'receivePublicKey': {
        const data = message.data as Record<string, unknown>
        const { responderEncryptedPublicKey } = data
        void this.sendInitialVaultData(
          responderEncryptedPublicKey as EncryptedPublicKey,
        )
        break
      }
      case 'receiveInitialVaultData': {
        const data = message.data as Record<string, unknown>
        const { encryptedVaultData, initiatorEncryptedPublicKey } = data
        void this.importInitialVaultData(
          encryptedVaultData as string,
          initiatorEncryptedPublicKey as EncryptedPublicKey,
        )
        break
      }
      case 'receiveCommand': {
        const data = message.data as Record<string, unknown>
        const encryptedSymmetricKey =
          data.encryptedSymmetricKey as EncryptedSymmetricKey
        const encryptedCommand = data.encryptedCommand as string
        void this.receiveCommand(encryptedSymmetricKey, encryptedCommand)
        break
      }
    }
  }

  /**
   * Initiate an add device flow.
   * @param returnQr - If true, returns a QR code as a string. If false, returns the raw data.
   * @returns A promise that resolves to the result of the add device flow.
   *          This result can be used to continue the flow and should be
   *          displayed to the user. If returnQr is true, the result is a QR code string.
   * @throws {Error} If an add device flow is already active.
   */
  async initiateAddDeviceFlow<T extends boolean = true>(
    returnQr: T = true as T,
  ): Promise<T extends true ? string : InitiateAddDeviceFlowResult> {
    if (this.activeAddDeviceFlow) {
      throw new SyncAddDeviceFlowConflictError()
    }
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }

    const addDevicePassword = deriveSFromPassword(
      Buffer.from(await this.cryptoLib.getRandomBytes(60)).toString('base64'),
    )
    const timestamp = Date.now()

    const jpak = new JPakeThreePass(this.userId)
    const pass1Result = jpak.pass1()

    const continuePromise = new Promise((resolve, reject) => {
      this.activeAddDeviceFlow = {
        state: 'initiator:initiated',
        jpak,
        addDevicePassword,
        initiatorUserIdString: this.userId,
        timestamp,
        resolveContinuePromise: resolve,
        rejectContinuePromise: reject,
      }
    })

    // register this add device request at the server
    this.ws.send(
      JSON.stringify({
        type: 'registerAddDeviceFlowRequest',
        data: {
          initiatorDeviceIdentifier: this.deviceIdentifier,
          initiatorUserIdString: this.userId,
          timestamp,
          nonce: await this.getNonce(),
        },
      }),
    )

    // wait for the server to confirm it has registered the add device request
    await continuePromise

    const returnData: InitiateAddDeviceFlowResult = {
      addDevicePassword: Buffer.from(addDevicePassword).toString('base64'),
      initiatorUserIdString: this.userId,
      initiatorDeviceIdentifier: this.deviceIdentifier,
      timestamp,
      pass1Result: {
        G1: Buffer.from(pass1Result.G1).toString('hex'),
        G2: Buffer.from(pass1Result.G2).toString('hex'),
        ZKPx1: Buffer.from(pass1Result.ZKPx1).toString('hex'),
        ZKPx2: Buffer.from(pass1Result.ZKPx2).toString('hex'),
      },
    }

    if (returnQr) {
      const qrGeneratorLib = await this.libraryLoader.getQrGeneratorLib()
      const qrString = await qrGeneratorLib.toDataURL(
        JSON.stringify(returnData),
      )

      // typescript has difficulty with the conditional types
      return qrString as T extends true ? typeof qrString : never
    } else {
      return returnData as T extends true ? never : typeof returnData
    }
  }

  /**
   * Responds to an add device flow initiated by another device.
   * @param initiatorData The data received from the initiating device.
   * @throws {Error} If the initiator data is invalid or if there's an error in the JPAKE process.
   */
  async respondToAddDeviceFlow(
    initiatorData: InitiateAddDeviceFlowResult | string | Buffer | File,
  ) {
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }
    if (this.activeAddDeviceFlow) {
      throw new SyncAddDeviceFlowConflictError()
    }

    const {
      addDevicePassword,
      initiatorUserIdString,
      timestamp,
      pass1Result,
      initiatorDeviceIdentifier,
    } = await decodeInitiatorData(
      initiatorData,
      await this.libraryLoader.getJsQrLib(),
      this.libraryLoader.getCanvasLib.bind(this),
    )

    if (
      !addDevicePassword ||
      !initiatorUserIdString ||
      !timestamp ||
      !pass1Result ||
      !initiatorDeviceIdentifier
    ) {
      throw new SyncError('Missing required fields in initiator data')
    }

    // Decode the base64 password
    const decodedPassword = Buffer.from(addDevicePassword, 'base64')

    const jpak = new JPakeThreePass(this.userId)

    // Process the first pass from the initiator
    const initiatorPass1Result = {
      G1: Buffer.from(pass1Result.G1, 'hex'),
      G2: Buffer.from(pass1Result.G2, 'hex'),
      ZKPx1: Buffer.from(pass1Result.ZKPx1, 'hex'),
      ZKPx2: Buffer.from(pass1Result.ZKPx2, 'hex'),
    }

    let pass2Result: Pass2Result
    try {
      pass2Result = jpak.pass2(
        initiatorPass1Result,
        decodedPassword,
        initiatorUserIdString,
      )
    } catch {
      throw new SyncError('Error processing initiator pass 1')
    }

    this.activeAddDeviceFlow = {
      state: 'responder:initated',
      jpak,
      addDevicePassword: decodedPassword,
      responderUserIdString: this.userId,
      initiatorUserIdString,
      initiatorDeviceIdentifier,
      timestamp: Date.now(),
    }

    // respond to this add device request at the server
    this.ws.send(
      JSON.stringify({
        type: 'addDevicePassPass2Result',
        data: {
          nonce: await this.getNonce(),
          pass2Result,
          responderUserIdString: this.userId,
          initiatorUserIdString,
          responderDeviceIdentifier: this.deviceIdentifier,
        },
      }),
    )
  }

  private async finishAddDeviceFlowKeyExchangeInitiator(
    pass2Result: Pass2Result,
    responderUserIdString: string,
    responderDeviceIdentifier: string,
  ) {
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }

    if (this.activeAddDeviceFlow?.state !== 'initiator:initiated') {
      throw new SyncInWrongStateError()
    }

    const pass3Result = this.activeAddDeviceFlow.jpak.pass3(
      pass2Result,
      this.activeAddDeviceFlow.addDevicePassword,
      responderUserIdString,
    )

    this.ws.send(
      JSON.stringify({
        type: 'addDevicePassPass3Result',
        data: {
          nonce: await this.getNonce(),
          initiatorUserIdString: this.activeAddDeviceFlow.initiatorUserIdString,
          pass3Result,
        },
      }),
    )

    const sharedKey = this.activeAddDeviceFlow.jpak.deriveSharedKey()
    const syncKey = await this.cryptoLib.createSyncKey(
      sharedKey,
      responderUserIdString.repeat(3), // repeat it so it is long enough to be used as a salt
    )
    this.activeAddDeviceFlow = {
      ...this.activeAddDeviceFlow,
      state: 'initiator:syncKeyCreated',
      responderUserIdString,
      responderDeviceIdentifier,
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
      throw new SyncInWrongStateError()
    }

    if (!this.publicKey) {
      throw new SyncError('Public key not set')
    }

    this.activeAddDeviceFlow.jpak.receivePass3Results(pass3Result)

    const sharedKey = this.activeAddDeviceFlow.jpak.deriveSharedKey()
    const syncKey = await this.cryptoLib.createSyncKey(
      sharedKey,
      this.activeAddDeviceFlow.responderUserIdString.repeat(3), // repeat it so it is long enough to be used as a salt
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
    this.ws.send(
      JSON.stringify({
        type: 'addDeviceFlowSendPublicKey',
        data: {
          nonce: await this.getNonce(),
          responderEncryptedPublicKey,
          initiatorUserIdString: this.activeAddDeviceFlow.initiatorUserIdString,
        },
      }),
    )
  }

  private async sendInitialVaultData(
    responderEncryptedPublicKey: EncryptedPublicKey,
  ) {
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }

    if (this.activeAddDeviceFlow?.state !== 'initiator:syncKeyCreated') {
      throw new SyncInWrongStateError()
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
      await this.persistentStoragemanager.getLockedRepresentation(syncKey)
    const initiatorEncryptedPublicKey = await this.cryptoLib.encryptSymmetric(
      syncKey,
      this.publicKey,
    )

    // Send the encrypted vault data to the server
    this.ws.send(
      JSON.stringify({
        type: 'sendInitialVaultData',
        data: {
          nonce: await this.getNonce(),
          encryptedVaultData,
          initiatorUserIdString: this.activeAddDeviceFlow.initiatorUserIdString,
          initiatorEncryptedPublicKey,
        },
      }),
    )

    this.syncDevices.push({
      userId: this.activeAddDeviceFlow.responderUserIdString,
      deviceIdentifier: this.activeAddDeviceFlow.responderDeviceIdentifier,
      publicKey: decryptedPublicKey as PublicKey,
    })
    this.persistentStoragemanager.__updateWasChangedSinceLastSave([
      'syncDevices',
    ])
    await this.persistentStoragemanager.save()

    // all done
    this.activeAddDeviceFlow = undefined
  }

  private async importInitialVaultData(
    encryptedVaultData: string,
    encryptedPublicKey: EncryptedPublicKey,
  ) {
    if (this.activeAddDeviceFlow?.state !== 'responder:syncKeyCreated') {
      throw new SyncInWrongStateError()
    }

    const syncKey = this.activeAddDeviceFlow.syncKey

    // Decrypt the received public key
    const decryptedPublicKey = await this.cryptoLib.decryptSymmetric(
      syncKey,
      encryptedPublicKey,
    )

    // Import the encrypted vault data using the ExportImportManager
    await this.persistentStoragemanager.loadFromLockedRepresentation(
      encryptedVaultData,
      syncKey,
    )

    // Update the sync devices list with the initiator's information
    this.syncDevices.push({
      userId: this.activeAddDeviceFlow.initiatorUserIdString,
      deviceIdentifier: this.activeAddDeviceFlow.initiatorDeviceIdentifier,
      publicKey: decryptedPublicKey as PublicKey,
    })
    this.persistentStoragemanager.__updateWasChangedSinceLastSave([
      'syncDevices',
    ])
    await this.persistentStoragemanager.save()

    // Reset the active add device flow
    this.activeAddDeviceFlow = undefined
  }

  async sendCommand(command: Command) {
    if (!this.ws || !this.webSocketConnected) {
      throw new SyncNoServerConnectionError()
    }

    const commandJson = command.toJSON()

    const data = await Promise.all(
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
            padding: generateRandomString(), // make it harder to guess the length
          }),
        )
        return {
          userId: device.userId,
          encryptedSymmetricKey,
          encryptedCommand,
        }
      }),
    )

    this.ws.send(
      JSON.stringify({
        type: 'sendCommand',
        data,
      }),
    )
  }

  async receiveCommand(
    encryptedSymmetricKey: EncryptedSymmetricKey,
    encryptedData: string,
  ) {
    const symmetricKey = (await this.cryptoLib.decrypt(
      this.privateKey,
      encryptedSymmetricKey,
    )) as SymmetricKey
    const data = JSON.parse(
      await this.cryptoLib.decryptSymmetric(symmetricKey, encryptedData),
    ) as RemoteCommand
    this.commandManager.receiveRemoteCommand(data)
    await this.commandManager.processRemoteCommands()
  }
}

export default SyncManager
