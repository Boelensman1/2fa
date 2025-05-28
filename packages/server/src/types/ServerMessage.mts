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
import type { Encrypted, EncryptedSymmetricKey, DeviceId } from 'favalib'

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
