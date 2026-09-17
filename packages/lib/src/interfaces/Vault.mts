import type { Tagged } from 'type-fest'
import type {
  EncryptedSecretKeys,
  EncryptedSymmetricKey,
  KdfParameters,
  MacKey,
  PrivateKey,
  Salt,
  SigningSecretKey,
  SymmetricKey,
} from './CryptoLib.mjs'
import type Entry from './Entry.mjs'
import type { DeviceFriendlyName, DeviceId, SyncDevice } from './SyncTypes.mjs'
import type { SyncCommandFromClient } from './protocol/ClientMessage.mjs'
import type {
  EncryptedVaultStateString,
  ServerSecret,
} from './BrandedTypes.mjs'

export type {
  EncryptedVaultStateString,
  VaultStateString,
} from './BrandedTypes.mjs'

export type Vault = Entry[]

export interface LockedRepresentation {
  /**
   * The device's two secret keys -- X25519 and Ed25519 -- sealed together with
   * AES-256-GCM under a key derived from the password hash.
   */
  encryptedSecretKeys: EncryptedSecretKeys
  /**
   * The key the vault state is encrypted under, sealed with AES-256-GCM under
   * a second key derived from the password hash.
   *
   * NOT wrapped to this device's own public key any more. That self-wrap is
   * what let anyone holding the public key choose their own symmetric key and
   * re-encrypt the whole vault state -- the forgery that made `envelopeMac`
   * necessary in the first place
   * (key-hierarchy-review/02-ciphertext-authenticity.md).
   */
  encryptedSymmetricKey: EncryptedSymmetricKey
  salt: Salt
  encryptedVaultState: EncryptedVaultStateString
  libVersion: string
  storageVersion: number
  /**
   * The argon2id parameters this vault was written with. Recorded rather than
   * hardcoded, so that the cost can be raised later without breaking existing
   * vaults.
   */
  kdf: KdfParameters
  /**
   * base64 HMAC-SHA256 over every other field, keyed from the password hash.
   *
   * This is what authenticates the vault to the holder of the PASSWORD. It was
   * added because the AES-GCM tag on `encryptedVaultState` could not: the key
   * it is under used to arrive via an RSA-OAEP wrap to this device's OWN public
   * key, so anyone holding that public key could pick their own key, wrap it,
   * and re-encrypt the whole vault state with a matching AAD.
   *
   * That self-wrap is gone -- the symmetric key is now sealed under a key
   * derived from the password hash, so a forger needs the password to produce a
   * readable vault at all. The MAC stays regardless: it covers the cleartext
   * fields no ciphertext authenticates, and dropping it would be a second
   * argument for no gain. See
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
 * stores about itself -- the salt, the kdf block, the sealed keys, the
 * encrypted vault state -- is deliberately absent: the consumer already holds
 * a LockedRepresentation, and reading those from it rather than from here
 * means the two can never disagree. The two PUBLIC keys are absent for a
 * related reason: they are pure functions of the secret keys, so a copy here
 * could only disagree with them.
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
  signingSecretKey: SigningSecretKey
  symmetricKey: SymmetricKey
  macKey: MacKey
}
export type UnlockedSessionString = Tagged<string, 'UnlockedSessionString'>

/**
 * One remote command this device has applied.
 *
 * `timestamp` is the sender's, taken from the SIGNED payload rather than from
 * the clock here: it is what the pruning bound and the per-peer floor are
 * measured against, so a value the server could choose would make both
 * meaningless.
 */
export interface ProcessedCommand {
  id: string
  from: DeviceId
  timestamp: number
}

/**
 * What this device has applied, kept so that a restart does not make every
 * queued command replayable again.
 *
 * `floors` is the price of bounding `commands`: pruning an id raises its
 * sender's floor to that id's timestamp, so forgetting an id never makes it
 * acceptable again. See key-hierarchy-review/15-sync-replay-protection.md.
 */
export interface ProcessedCommandRecord {
  commands: ProcessedCommand[]
  floors: Record<DeviceId, number>
}

export interface VaultSyncState {
  devices: SyncDevice[]
  /**
   * Device ids this vault has removed, against the time of removal.
   *
   * A tombstone, and the reason removal converges. `removeSyncDevice` used to
   * splice an array, which a peer could undo without meaning to: a device
   * removed here is still in the device list of a peer that was offline at the
   * time, and that peer's next resilver carried it straight back in through
   * `importVaultState`. A removed device would then verify again, so the one
   * remediation the user has did not stick.
   *
   * It blocks *introduction*, never pairing. A JPAKE flow clears the tombstone
   * and re-enrols, because that is the user standing in front of both devices
   * saying so. See key-hierarchy-review/14-sync-device-injection.md.
   *
   * Absent in vaults written before tombstones existed, which is why it is
   * optional: a vault that has removed nothing has nothing to record.
   */
  removedDevices?: Record<DeviceId, number>
  serverUrl: string | undefined
  /**
   * The static secret this vault authenticates to its sync server with.
   *
   * Optional for the same reason `serverUrl` is nullable: a vault with sync
   * switched off has neither. Absent WITH a `serverUrl` present means a vault
   * written before the server grew a connection gate, and it gets no
   * SyncManager at all (FavaLib) rather than a connection that fails at the
   * handshake -- the user sets the server again, url and secret together.
   *
   * It is stored, never sent. `PersistentStorageManager` leaves it out of the
   * peer-bound form of this struct, so the secret appears in no message on this
   * wire, sealed or otherwise.
   */
  serverSecret?: ServerSecret
  commandSendQueue: SyncCommandFromClient[]
  /**
   * Absent in vaults written before replay protection was persisted, which is
   * why it is optional: an empty record is the correct starting point, since a
   * device that has applied nothing cannot have applied anything twice.
   */
  processedCommands?: ProcessedCommandRecord
}
/**
 * A sync state that is actually configured: both halves present.
 *
 * The two are required together because neither is usable alone -- a url with
 * no secret cannot get past the server's handshake, and a secret with no url
 * has nothing to authenticate to. Requiring them as a pair is what lets
 * `SyncManager` treat both as non-null for its whole lifetime.
 */
export type VaultSyncStateWithServerUrl = Omit<
  VaultSyncState,
  'serverUrl' | 'serverSecret'
> & {
  serverUrl: NonNullable<VaultSyncState['serverUrl']>
  serverSecret: NonNullable<VaultSyncState['serverSecret']>
}
export interface VaultState {
  deviceId: DeviceId
  deviceFriendlyName?: DeviceFriendlyName
  vault: Vault
  sync: VaultSyncState
}
