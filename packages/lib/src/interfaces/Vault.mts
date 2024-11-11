import type { Tagged } from 'type-fest'
import type {
  Encrypted,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
} from './CryptoLib.mjs'
import type Entry from './Entry.mjs'
import { DeviceId, SyncDevice } from './SyncTypes.mjs'
import { SyncCommandFromClient } from '2faserver/ClientMessage'

export type Vault = Entry[]

export type EncryptedVaultStateString = Encrypted<VaultStateString>
export interface LockedRepresentation {
  encryptedPrivateKey: EncryptedPrivateKey
  encryptedSymmetricKey: EncryptedSymmetricKey
  salt: Salt
  encryptedVaultState: EncryptedVaultStateString
  libVersion: string
  storageVersion: number
}
export type LockedRepresentationString = Tagged<
  string,
  'LockedRepresentationString'
>

export interface VaultSyncState {
  devices: SyncDevice[]
  serverUrl: string | undefined
  commandSendQueue: SyncCommandFromClient[]
}
export type VaultSyncStateWithServerUrl = Omit<VaultSyncState, 'serverUrl'> & {
  serverUrl: NonNullable<VaultSyncState['serverUrl']>
}
export interface VaultState {
  deviceId: DeviceId
  vault: Vault
  sync: VaultSyncState
}
export type VaultStateString = Tagged<string, 'VaultState'>
