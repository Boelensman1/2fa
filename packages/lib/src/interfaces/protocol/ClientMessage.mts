import type {
  DeviceId,
  Encrypted,
  EncryptedPublicKeys,
  EncryptedSymmetricKey,
  EncryptedVaultStateString,
  Signature,
} from '../BrandedTypes.mjs'
import type JsonifiedUint8Array from './JsonifiedUint8Array.mjs'

/**
 * Answers the server's `authChallenge`, and must be the first message a socket
 * sends: every other type is refused until this one is accepted.
 *
 * Note what is absent. There is no `deviceId` here, because the proof cannot
 * speak about one -- the secret behind it belongs to the deployment, not to a
 * device.
 */
export interface AuthProofClientMessage {
  type: 'authProof'
  data: {
    /** base64 HMAC-SHA256 over buildConnectAuthMessage(nonce). */
    proof: string
  }
}

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
    /**
     * The initiator's one-pairing ML-KEM public key, base64.
     *
     * Relayed through the server rather than carried in the QR code, which is
     * why the out-of-band payload has a digest of it: 1184 bytes would make for
     * a punishing QR code, 32 would not. The responder checks the digest before
     * it answers, so the server relaying this cannot substitute its own.
     *
     * base64 rather than the JsonifiedUint8Array the JPAKE fields use. That
     * encoding is a Record<string, number> -- roughly seven bytes of JSON per
     * byte of key -- which the 32-byte JPAKE values can afford and this cannot.
     */
    kemPublicKey: string
  }
}

export interface PublicKeyAndDeviceInfoClientMessage {
  type: 'publicKeyAndDeviceInfo'
  data: {
    initiatorDeviceId: DeviceId
    responderEncryptedPublicKeys: EncryptedPublicKeys
    responderEncryptedDeviceInfo: Encrypted<string>
    /**
     * The ML-KEM ciphertext the responder encapsulated to `kemPublicKey`, base64.
     *
     * In the clear, beside two fields that are not, and it has to be: the sync
     * key those two are encrypted under is derived FROM this ciphertext, so the
     * initiator cannot read anything here until it has decapsulated. Publishing
     * it costs nothing -- a KEM ciphertext is public by construction -- and it
     * is bound into the key derivation transcript, so a server that swaps it
     * only stops the two sides agreeing.
     */
    kemCipherText: string
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
     * be the only statement about who sent it.
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
  | AuthProofClientMessage
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
