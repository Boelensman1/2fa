import type { EmptyObject } from 'type-fest'
import type {
  JPAKEPass2Message as JPAKEPass2ServerMessage,
  JPAKEPass3Message as JPAKEPass3ServerMessage,
  PublicKeyMessage as PublicKeyServerMessage,
  VaultMessage as VaultServerMessage,
  AddSyncDeviceCancelledMessage as AddSyncDeviceCancelledServerMessage,
} from './ClientMessage.mjs'
import { Encrypted, EncryptedSymmetricKey } from '2falib'

export interface ConfirmAddSyncDeviceInitialiseData {
  type: 'confirmAddSyncDeviceInitialiseData'
  data: EmptyObject
}

export type JPAKEPass2Message = JPAKEPass2ServerMessage
export type JPAKEPass3Message = JPAKEPass3ServerMessage
export type PublicKeyMessage = PublicKeyServerMessage
export type VaultMessage = VaultServerMessage
export type AddSyncDeviceCancelledMessage = AddSyncDeviceCancelledServerMessage

export interface SyncCommandMessage {
  type: 'syncCommand'
  data: {
    encryptedCommands: Encrypted<string>
    encryptedSymmetricKey: EncryptedSymmetricKey
  }
}

type OutgoingMessage =
  | ConfirmAddSyncDeviceInitialiseData
  | JPAKEPass2Message
  | JPAKEPass3Message
  | PublicKeyMessage
  | VaultMessage
  | SyncCommandMessage
  | AddSyncDeviceCancelledMessage

export default OutgoingMessage
