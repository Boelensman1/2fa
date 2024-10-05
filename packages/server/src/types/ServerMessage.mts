import type {
  JPAKEPass2Message as JPAKEPass2ServerMessage,
  JPAKEPass3Message as JPAKEPass3ServerMessage,
  PublicKeyMessage as PublicKeyServerMessage,
  VaultMessage as VaultServerMessage,
} from './ClientMessage.mjs'

export interface ConfirmAddSyncDeviceInitialiseData {
  type: 'confirmAddSyncDeviceInitialiseData'
  data: Record<string, never> // empty object
}

export type JPAKEPass2Message = JPAKEPass2ServerMessage
export type JPAKEPass3Message = JPAKEPass3ServerMessage
export type PublicKeyMessage = PublicKeyServerMessage
export type VaultMessage = VaultServerMessage

export interface SyncCommandMessage {
  type: 'syncCommand'
  data: {
    encryptedCommands: string
    encryptedSymmetricKey: string
  }
}

type OutgoingMessage =
  | ConfirmAddSyncDeviceInitialiseData
  | JPAKEPass2Message
  | JPAKEPass3Message
  | PublicKeyMessage
  | VaultMessage
  | SyncCommandMessage

export default OutgoingMessage
