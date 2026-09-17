import type { Tagged } from 'type-fest'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  KdfParameters,
  MacKey,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
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
  /**
   * The argon2id parameters this vault was written with. Absent in storage
   * version 1, where they were hardcoded; required from version 2, so that the
   * cost can be raised again later without breaking existing vaults.
   */
  kdf: KdfParameters
  /**
   * base64 HMAC-SHA256 over every other field, keyed from the password hash.
   * Absent in storage version 1, required from version 2.
   *
   * This is what authenticates the vault to the holder of the PASSWORD. The
   * AES-GCM tag on `encryptedVaultState` cannot: the key it is under arrives
   * via an RSA-OAEP wrap to this device's OWN public key, so anyone holding
   * that public key can pick their own key, wrap it, and re-encrypt the whole
   * vault state with a matching AAD. See
   * key-hierarchy-review/02-ciphertext-authenticity.md.
   */
  envelopeMac: string
}
export type LockedRepresentationString = Tagged<
  string,
  'LockedRepresentationString'
>

/**
 * The derived key material of an unlocked vault, in a form a consumer can hold
 * across a process restart -- see key-hierarchy-review/07-session-key-api.md.
 *
 * Only the four secrets that a password unlock DERIVES. Everything a vault
 * stores about itself -- the salt, the kdf block, both encrypted keys, the
 * encrypted vault state -- is deliberately absent: the consumer already holds
 * a LockedRepresentation, and reading those from it rather than from here
 * means the two can never disagree.
 *
 * This is PLAINTEXT KEY MATERIAL. Whoever reads it reads the vault. It is
 * declared here rather than in BrandedTypes.mts (which is what `favalib/types`
 * resolves to, and what favaserver imports back) on purpose: that module holds
 * the types that legitimately cross a process boundary, and this one must
 * never leave the device.
 */
export interface UnlockedSession {
  sessionVersion: number
  privateKey: PrivateKey
  publicKey: PublicKey
  symmetricKey: SymmetricKey
  macKey: MacKey
}
export type UnlockedSessionString = Tagged<string, 'UnlockedSessionString'>

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
