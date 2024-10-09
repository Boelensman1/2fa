import type JsonifiedUint8Array from './JsonifiedUint8Array.mjs'

export interface ConnectMessage {
  type: 'connect'
  data: {
    userId: string
  }
}

export interface AddSyncDeviceInitialiseDataMessage {
  type: 'addSyncDeviceInitialiseData'
  data: {
    initiatorDeviceIdentifier: string
    initiatorUserIdString: string
    timestamp: number
    nonce: string
  }
}

export interface JPAKEPass2Message {
  type: 'JPAKEPass2'
  data: {
    nonce: string
    pass2Result: {
      round1Result: {
        G1: JsonifiedUint8Array
        G2: JsonifiedUint8Array
        ZKPx1: JsonifiedUint8Array
        ZKPx2: JsonifiedUint8Array
      }
      round2Result: {
        A: JsonifiedUint8Array
        ZKPx2s: JsonifiedUint8Array
      }
    }
    responderUserIdString: string
    responderDeviceIdentifier: string
    initiatorUserIdString: string
  }
}

export interface JPAKEPass3Message {
  type: 'JPAKEPass3'
  data: {
    nonce: string
    initiatorUserIdString: string
    pass3Result: { A: JsonifiedUint8Array; ZKPx2s: JsonifiedUint8Array }
  }
}

export interface PublicKeyMessage {
  type: 'publicKey'
  data: {
    initiatorUserIdString: string
    nonce: string
    responderEncryptedPublicKey: string
  }
}

export interface VaultMessage {
  type: 'vault'
  data: {
    nonce: string
    initiatorUserIdString: string
    initiatorEncryptedPublicKey: string
    encryptedVaultData: string
  }
}

export interface SyncCommandMessage {
  type: 'syncCommand'
  data: {
    userId: string
    encryptedCommands: string
    encryptedSymmetricKey: string
  }[]
}

export interface AddSyncDeviceCancelledMessage {
  type: 'addSyncDeviceCancelled'
  data: {
    initiatorUserIdString: string
  }
}

type IncomingMessage =
  | ConnectMessage
  | AddSyncDeviceInitialiseDataMessage
  | JPAKEPass2Message
  | JPAKEPass3Message
  | PublicKeyMessage
  | VaultMessage
  | SyncCommandMessage
  | AddSyncDeviceCancelledMessage

export default IncomingMessage
