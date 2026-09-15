import type { Tagged } from 'type-fest'

/** Represents a device id */
export type DeviceId = Tagged<string, 'DeviceId'>

/** Represents a public key */
export type PublicKey = Tagged<string, 'PublicKey'>

/** Represents a symmetric key */
export type SymmetricKey = Tagged<string, 'SymmetricKey'>

/** Represents the stringified form of a vault state */
export type VaultStateString = Tagged<string, 'VaultState'>

// `Encrypted<T>` tags the original string type to denote that it is encrypted
export type Encrypted<T extends string> = Tagged<T, 'Encrypted'>

/** Represents an encrypted symmetric key (base64 encoded) */
export type EncryptedSymmetricKey = Encrypted<SymmetricKey>

/** Represents an encrypted public key (base64 encoded) */
export type EncryptedPublicKey = Encrypted<PublicKey>

/** Represents an encrypted vault state (base64 encoded) */
export type EncryptedVaultStateString = Encrypted<VaultStateString>
