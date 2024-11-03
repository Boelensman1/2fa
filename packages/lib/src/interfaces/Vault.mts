import type { Tagged } from 'type-fest'
import type {
  Encrypted,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Salt,
} from './CryptoLib.mjs'
import type Entry from './Entry.mjs'
import { DeviceId, SyncDevice } from './SyncTypes.mjs'

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
export interface VaultState {
  deviceId: DeviceId
  syncDevices: SyncDevice[]
  vault: Vault
}
export type VaultStateString = Tagged<string, 'VaultState'>
