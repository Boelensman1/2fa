import type {
  DeviceId,
  DeviceType,
  Encrypted,
  EncryptedPublicKey,
  EncryptedSymmetricKey,
  EncryptedVaultData,
} from '2falib'
import type JsonifiedUint8Array from './JsonifiedUint8Array.mjs'

export interface ConnectMessage {
  type: 'connect'
  data: {
    deviceId: DeviceId
  }
}

export interface AddSyncDeviceInitialiseDataMessage {
  type: 'addSyncDeviceInitialiseData'
  data: {
    initiatorDeviceType: DeviceType
    initiatorDeviceId: DeviceId
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
    responderDeviceId: DeviceId
    responderDeviceType: DeviceType
    initiatorDeviceId: DeviceId
  }
}

export interface JPAKEPass3Message {
  type: 'JPAKEPass3'
  data: {
    nonce: string
    initiatorDeviceId: DeviceId
    pass3Result: { A: JsonifiedUint8Array; ZKPx2s: JsonifiedUint8Array }
  }
}

export interface PublicKeyMessage {
  type: 'publicKey'
  data: {
    initiatorDeviceId: DeviceId
    nonce: string
    responderEncryptedPublicKey: EncryptedPublicKey
  }
}

export interface VaultMessage {
  type: 'vault'
  data: {
    nonce: string
    initiatorDeviceId: DeviceId
    initiatorEncryptedPublicKey: EncryptedPublicKey
    encryptedVaultData: EncryptedVaultData
  }
}

export interface AddSyncDeviceCancelledMessage {
  type: 'addSyncDeviceCancelled'
  data: {
    initiatorDeviceId: DeviceId
  }
}

export interface SyncCommandMessage {
  type: 'syncCommand'
  data: {
    deviceId: DeviceId
    encryptedCommands: Encrypted<string>
    encryptedSymmetricKey: EncryptedSymmetricKey
  }[]
}

export interface SyncCommandExecutedMessage {
  type: 'syncCommandExecuted'
  data: {
    id: number
  }
}

type IncomingMessage =
  | ConnectMessage
  | AddSyncDeviceInitialiseDataMessage
  | JPAKEPass2Message
  | JPAKEPass3Message
  | PublicKeyMessage
  | VaultMessage
  | AddSyncDeviceCancelledMessage
  | SyncCommandMessage
  | SyncCommandExecutedMessage

export default IncomingMessage
