import type { EmptyObject } from 'type-fest'
import type {
  JPAKEPass2ClientMessage,
  JPAKEPass3ClientMessage,
  PublicKeyAndDeviceInfoClientMessage,
  InitialVaultClientMessage,
  VaultClientMessage,
  AddSyncDeviceCancelledClientMessage,
  StartResilverClientMessage,
} from './ClientMessage.mjs'
import type {
  Encrypted,
  EncryptedSymmetricKey,
  DeviceId,
} from '../BrandedTypes.mjs'

export interface ConfirmAddSyncDeviceInitialiseServerMessage {
  type: 'confirmAddSyncDeviceInitialiseData'
  data: EmptyObject
}

export type JPAKEPass2ServerMessage = JPAKEPass2ClientMessage
export type JPAKEPass3ServerMessage = JPAKEPass3ClientMessage
export type PublicKeyServerMessage = PublicKeyAndDeviceInfoClientMessage
export type InitialVaultServerMessage = InitialVaultClientMessage
export type AddSyncDeviceCancelledServerMessage =
  AddSyncDeviceCancelledClientMessage
export type StartResilverServerMessage = StartResilverClientMessage

export interface SyncCommandFromServer {
  commandId: string
  /**
   * A SignedCommandEnvelope, sealed to this device.
   *
   * There is still no sender on the envelope, and there deliberately is not:
   * the sender names itself INSIDE the ciphertext and signs that name, so the
   * server cannot read who is talking to whom, and cannot change it either.
   */
  encryptedCommand: Encrypted<string>
  encryptedSymmetricKey: EncryptedSymmetricKey
}
export interface SyncCommandsServerMessage {
  type: 'syncCommands'
  data: SyncCommandFromServer[]
}
export interface SyncCommandReceivedServerMessage {
  type: 'syncCommandsReceived'
  data: { commandIds: string[] }
}

export interface VaultServerMessage extends Omit<VaultClientMessage, 'data'> {
  data: VaultClientMessage['data'] & {
    /**
     * Stamped by the server, so on its own it is a claim rather than a fact.
     * The recipient checks the `signature` beside it against the key it holds
     * for this device, which is what makes the claim testable.
     */
    fromDeviceId: DeviceId
  }
}

type OutgoingMessage =
  | ConfirmAddSyncDeviceInitialiseServerMessage
  | JPAKEPass2ServerMessage
  | JPAKEPass3ServerMessage
  | PublicKeyServerMessage
  | InitialVaultServerMessage
  | VaultServerMessage
  | SyncCommandsServerMessage
  | AddSyncDeviceCancelledServerMessage
  | SyncCommandReceivedServerMessage
  | StartResilverServerMessage

export default OutgoingMessage
