import type {
  DeviceId,
  Encrypted,
  EncryptedPublicKeys,
  EncryptedSymmetricKey,
  EncryptedVaultStateString,
  Signature,
} from '../BrandedTypes.mjs'
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
  }
}

export interface JPAKEPass2ClientMessage {
  type: 'JPAKEPass2'
  data: {
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
    initiatorDeviceId: DeviceId
    pass3Result: { A: JsonifiedUint8Array; ZKPx2s: JsonifiedUint8Array }
  }
}

export interface PublicKeyAndDeviceInfoClientMessage {
  type: 'publicKeyAndDeviceInfo'
  data: {
    initiatorDeviceId: DeviceId
    responderEncryptedPublicKeys: EncryptedPublicKeys
    responderEncryptedDeviceInfo: Encrypted<string>
  }
}

export interface InitialVaultClientMessage {
  type: 'initialVault'
  data: {
    initiatorDeviceId: DeviceId
    encryptedVaultData: EncryptedVaultStateString
  }
}

export interface VaultClientMessage {
  type: 'vault'
  data: {
    forDeviceId: DeviceId
    encryptedVaultData: EncryptedVaultStateString
    encryptedSymmetricKey: EncryptedSymmetricKey
    /**
     * Ed25519 over buildVaultDataSignatureMessage, by the sending device.
     *
     * Without it a resilvered vault is only sealed, and sealing is a public
     * operation: the `fromDeviceId` the server stamps on the way through would
     * be the only statement about who sent it. See
     * key-hierarchy-review/13-sync-command-authentication.md.
     */
    signature: Signature
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
  /** The RECIPIENT. The sender is named inside the ciphertext, and signed. */
  deviceId: DeviceId
  /** A SignedCommandEnvelope, sealed to the recipient. */
  encryptedCommand: Encrypted<string>
  encryptedSymmetricKey: EncryptedSymmetricKey
}
export interface SyncCommandsClientMessage {
  type: 'syncCommands'
  data: {
    commands: SyncCommandFromClient[]
  }
}

export interface SyncCommandsExecutedClientMessage {
  type: 'syncCommandsExecuted'
  data: {
    /**
     * Commands the server may delete: newly applied commands, authenticated
     * duplicates, and authenticated commands permanently refused by replay floors.
     */
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
  | PublicKeyAndDeviceInfoClientMessage
  | InitialVaultClientMessage
  | VaultClientMessage
  | AddSyncDeviceCancelledClientMessage
  | SyncCommandsClientMessage
  | SyncCommandsExecutedClientMessage
  | StartResilverClientMessage

export default IncomingMessage
