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

/**
 * The first thing a socket receives, before it has said anything at all.
 *
 * The client answers with an `authProof` over this nonce, which is what keeps
 * the shared secret off the wire: a plain `ws://` link in development would
 * otherwise hand it to anyone watching, and a token sent once is replayable
 * forever. The nonce is drawn per socket and accepted once, so a captured proof
 * is worth nothing on the next connection.
 */
export interface AuthChallengeServerMessage {
  type: 'authChallenge'
  data: {
    /** base64 of 32 CSPRNG bytes, valid for this socket and one proof. */
    nonce: string
  }
}

/**
 * Sent once a proof is accepted, and the signal the client waits for before it
 * sends `connect`, reports itself connected or flushes its send queue.
 *
 * A refusal is not its counterpart: there is no `authRejected`. Every way this
 * handshake can fail closes the socket with 4401 and the same reason, because a
 * server that distinguishes "wrong secret" from "you spoke too early" is
 * answering questions for whoever is probing it.
 */
export interface AuthAcceptedServerMessage {
  type: 'authAccepted'
  data: EmptyObject
}

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
  | AuthChallengeServerMessage
  | AuthAcceptedServerMessage
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
