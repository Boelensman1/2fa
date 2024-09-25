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
} from './interfaces/SyncTypes.js'
import { decodeInitiatorData, jsonToUint8Array } from './utils/syncUtils.mjs'

import type LibraryLoader from './LibraryLoader.mjs'

// Ensure Buffer is available globally for the browser environment
import { Buffer } from 'buffer'
globalThis.Buffer = Buffer

class SyncManager {
  private ws?: WebSocket
  private activeAddDeviceFlow?: ActiveAddDeviceFlow

  constructor(
    private libraryLoader: LibraryLoader,
    private readonly deviceIdentifier: string,
  ) {}

  private get cryptoLib() {
    return this.libraryLoader.getCryptoLib()
  }

  get inAddDeviceFlow(): boolean {
    return Boolean(this.activeAddDeviceFlow)
  }
  get webSocketConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  initServerConnection(serverUrl: string) {
    const ws = new WebSocket(serverUrl)

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const libInstance = this
    ws.addEventListener('error', console.error)

    /*
    ws.addEventListener('open', function open() {
      ws.send('Hi!')
    })
    */

    ws.addEventListener('message', function message(message: MessageEvent) {
      try {
        const jsonString = String(message.data)
        const parsedMessage = JSON.parse(jsonString) as Record<string, unknown>

        libInstance.handleServerMessage(parsedMessage)
      } catch (error) {
        console.error('Failed to parse message:', error)
      }
    })

    this.ws = ws
  }

  private handleServerMessage(message: Record<string, unknown>) {
    switch (message.type) {
      case 'addDeviceFlowRequestRegistered':
        if (this.activeAddDeviceFlow?.resolveContinuePromise) {
          this.activeAddDeviceFlow.resolveContinuePromise(message)
        }
        break
      case 'addDevicePassPass2Result':
        if (this.activeAddDeviceFlow) {
          const data = message.data as Record<string, unknown>

          const unconvertedPass2Result = data.pass2Result as Record<
            string,
            Record<string, Record<string, number>>
          >
          const pass2Result = {
            round1Result: jsonToUint8Array(unconvertedPass2Result.round1Result),
            round2Result: jsonToUint8Array(unconvertedPass2Result.round2Result),
          } as unknown as Pass2Result

          void this.finishAddDeviceFlow(pass2Result, data.userId as string)
        }
        break
      case 'addDevicePassPass3Result':
        if (this.activeAddDeviceFlow) {
          const data = message.data as Record<string, unknown>

          const pass3Result = jsonToUint8Array(
            (data as Record<string, Record<string, Record<string, number>>>)
              .pass3Result,
          ) as unknown as Pass3Result

          this.finishAddDeviceFlow2(pass3Result)
        }
        break
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
      throw new Error('Add device flow already active')
    }
    if (!this.ws || !this.webSocketConnected) {
      throw new Error('Server connection not available')
    }

    const addDevicePassword = deriveSFromPassword(
      Buffer.from(await this.cryptoLib.getRandomBytes(60)).toString('base64'),
    )
    const timestamp = Date.now()

    const userId = await this.cryptoLib.getRandomBytes(3)
    // add a I (for initiator) to ensure no userId conflicts
    const userIdString = 'I' + Buffer.from(userId).readUInt16BE(0).toString()

    const jpak = new JPakeThreePass(userIdString)
    const pass1Result = jpak.pass1()

    const continuePromise = new Promise((resolve, reject) => {
      this.activeAddDeviceFlow = {
        jpak,
        addDevicePassword,
        userId,
        userIdString,
        timestamp,
        resolveContinuePromise: resolve,
        rejectContinuePromise: reject,
      }
    })

    // register this add device request at the server
    const nonce = Buffer.from(await this.cryptoLib.getRandomBytes(16)).toString(
      'base64',
    )
    this.ws.send(
      JSON.stringify({
        type: 'registerAddDeviceFlowRequest',
        data: {
          deviceIdentifier: this.deviceIdentifier,
          userIdString,
          timestamp,
          nonce,
        },
      }),
    )

    // wait for the server to confirm it has registered the add device request
    await continuePromise

    const returnData: InitiateAddDeviceFlowResult = {
      addDevicePassword: Buffer.from(addDevicePassword).toString('base64'),
      userIdString,
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
      throw new Error('Server connection not available')
    }

    const {
      addDevicePassword,
      userIdString: initiatorUserIdString,
      timestamp,
      pass1Result,
    } = await decodeInitiatorData(
      initiatorData,
      await this.libraryLoader.getJsQrLib(),
      this.libraryLoader.getCanvasLib.bind(this),
    )

    if (
      !addDevicePassword ||
      !initiatorUserIdString ||
      !timestamp ||
      !pass1Result
    ) {
      throw new Error('Missing required fields in initiator data')
    }

    // Decode the base64 password
    const decodedPassword = Buffer.from(addDevicePassword, 'base64')

    const userId = await this.cryptoLib.getRandomBytes(3)
    // add a R (for responder) to ensure no userId conflicts
    const userIdString = 'R' + Buffer.from(userId).readUInt16BE(0).toString()

    const jpak = new JPakeThreePass(userIdString)

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
      throw new Error('Error processing initiator pass 1')
    }

    this.activeAddDeviceFlow = {
      jpak,
      addDevicePassword: decodedPassword,
      userId,
      userIdString,
      timestamp: Date.now(),
    }

    // respond to this add device request at the server
    const nonce = Buffer.from(await this.cryptoLib.getRandomBytes(16)).toString(
      'base64',
    )
    this.ws.send(
      JSON.stringify({
        type: 'addDevicePassPass2Result',
        data: {
          nonce,
          pass2Result,
          userId: userIdString,
          initiatorUserIdString,
        },
      }),
    )
  }

  private async finishAddDeviceFlow(
    pass2Result: Pass2Result,
    responderUserId: string,
  ) {
    if (!this.ws || !this.webSocketConnected) {
      throw new Error('Server connection not available')
    }

    if (!this.activeAddDeviceFlow) {
      throw new Error('No active add device flow')
    }

    const pass3Result = this.activeAddDeviceFlow.jpak.pass3(
      pass2Result,
      this.activeAddDeviceFlow.addDevicePassword,
      responderUserId,
    )

    const nonce = Buffer.from(await this.cryptoLib.getRandomBytes(16)).toString(
      'base64',
    )
    this.ws.send(
      JSON.stringify({
        type: 'addDevicePassPass3Result',
        data: {
          nonce,
          userId: this.activeAddDeviceFlow.userIdString,
          pass3Result,
        },
      }),
    )

    const sharedKey = this.activeAddDeviceFlow.jpak.deriveSharedKey()
    console.log('1', sharedKey)
  }

  private finishAddDeviceFlow2(pass3Result: Pass3Result) {
    if (!this.ws || !this.webSocketConnected) {
      throw new Error('Server connection not available')
    }

    if (!this.activeAddDeviceFlow) {
      throw new Error('No active add device flow')
    }

    this.activeAddDeviceFlow.jpak.receivePass3Results(pass3Result)

    const sharedKey = this.activeAddDeviceFlow.jpak.deriveSharedKey()
    console.log('2', sharedKey)
  }
}

export default SyncManager
