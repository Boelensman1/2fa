import type {
  DeviceId,
  Encrypted,
  EncryptedPublicKey,
  EncryptedSymmetricKey,
  EncryptedVaultStateString,
} from 'favalib'
import type JsonifiedUint8Array from './JsonifiedUint8Array.mjs'

export interface ConnectClientMessage {
  type: 'connect'
  data: {
    deviceId: DeviceId
  }
}

export interface AddSyncDeviceInitialiseDataClientMessage {
  type: 'addSyncDeviceInitialiseData'
  data: {
    initiatorDeviceId: DeviceId
    timestamp: number
    nonce: string
  }
}

export interface JPAKEPass2ClientMessage {
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
    initiatorDeviceId: DeviceId
  }
}

export interface JPAKEPass3ClientMessage {
  type: 'JPAKEPass3'
  data: {
    nonce: string
    initiatorDeviceId: DeviceId
    pass3Result: { A: JsonifiedUint8Array; ZKPx2s: JsonifiedUint8Array }
  }
}

export interface PublicKeyClientMessage {
  type: 'publicKey'
  data: {
    initiatorDeviceId: DeviceId
    nonce: string
    responderEncryptedPublicKey: EncryptedPublicKey
  }
}

export interface InitialVaultClientMessage {
  type: 'initialVault'
  data: {
    initiatorDeviceId: DeviceId
    nonce: string
    encryptedVaultData: EncryptedVaultStateString
  }
}

export interface VaultClientMessage {
  type: 'vault'
  data: {
    forDeviceId: DeviceId
    nonce: string
    encryptedVaultData: EncryptedVaultStateString
    encryptedSymmetricKey: EncryptedSymmetricKey
  }
}

export interface AddSyncDeviceCancelledClientMessage {
  type: 'addSyncDeviceCancelled'
  data: {
    initiatorDeviceId: DeviceId
  }
}

export interface SyncCommandFromClient {
  commandId: string
  deviceId: DeviceId
  encryptedCommand: Encrypted<string>
  encryptedSymmetricKey: EncryptedSymmetricKey
}
export interface SyncCommandsClientMessage {
  type: 'syncCommands'
  data: {
    nonce: string
    commands: SyncCommandFromClient[]
  }
}

export interface SyncCommandsExecutedClientMessage {
  type: 'syncCommandsExecuted'
  data: {
    commandIds: string[]
  }
}

export interface StartResilverClientMessage {
  type: 'startResilver'
  data: {
    deviceIds: DeviceId[]
  }
}

type IncomingMessage =
  | ConnectClientMessage
  | AddSyncDeviceInitialiseDataClientMessage
  | JPAKEPass2ClientMessage
  | JPAKEPass3ClientMessage
  | PublicKeyClientMessage
  | InitialVaultClientMessage
  | VaultClientMessage
  | AddSyncDeviceCancelledClientMessage
  | SyncCommandsClientMessage
  | SyncCommandsExecutedClientMessage
  | StartResilverClientMessage

export default IncomingMessage
