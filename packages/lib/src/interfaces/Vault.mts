import type { Tagged } from 'type-fest'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
} from './CryptoLib.mjs'
import type Entry from './Entry.mjs'
import type { DeviceFriendlyName, DeviceId, SyncDevice } from './SyncTypes.mjs'
import type { SyncCommandFromClient } from './protocol/ClientMessage.mjs'
import type { EncryptedVaultStateString } from './BrandedTypes.mjs'

export type {
  EncryptedVaultStateString,
  VaultStateString,
} from './BrandedTypes.mjs'

export type Vault = Entry[]

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
  deviceFriendlyName?: DeviceFriendlyName
  vault: Vault
  sync: VaultSyncState
}
