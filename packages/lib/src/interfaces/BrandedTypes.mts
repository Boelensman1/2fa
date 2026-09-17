import type { Tagged } from 'type-fest'

/** Represents a device id */
export type DeviceId = Tagged<string, 'DeviceId'>

/**
 * Represents a device's X25519 public key (base64 encoded, 32 raw bytes).
 *
 * The KEY AGREEMENT half of a device's identity: what a peer seals a message
 * to. The signing half is SigningPublicKey, and the two are deliberately
 * separate types -- they are both 32 base64-encoded bytes, so nothing but the
 * type system can tell one from the other at a call site.
 *
 * Not versioned in itself. Every surface a key travels on carries a version of
 * its own (storageVersion in the vault, pairingVersion in a pairing payload,
 * version in a command), so a tag here would be a second source of truth that
 * could only ever disagree with the first.
 */
export type PublicKey = Tagged<string, 'PublicKey'>

/** Represents a device's Ed25519 public key (base64 encoded, 32 raw bytes) */
export type SigningPublicKey = Tagged<string, 'SigningPublicKey'>

/** Represents an Ed25519 signature (base64 encoded, 64 raw bytes) */
export type Signature = Tagged<string, 'Signature'>

/** Represents a symmetric key */
export type SymmetricKey = Tagged<string, 'SymmetricKey'>

/** Represents the stringified form of a vault state */
export type VaultStateString = Tagged<string, 'VaultState'>

/** Represents the stringified form of a device's pair of public keys */
export type PublicKeysString = Tagged<string, 'PublicKeysString'>

// `Encrypted<T>` tags the original string type to denote that it is encrypted
export type Encrypted<T extends string> = Tagged<T, 'Encrypted'>

/** Represents an encrypted symmetric key (base64 encoded) */
export type EncryptedSymmetricKey = Encrypted<SymmetricKey>

/** Represents a device's encrypted pair of public keys (base64 encoded) */
export type EncryptedPublicKeys = Encrypted<PublicKeysString>

/** Represents an encrypted vault state (base64 encoded) */
export type EncryptedVaultStateString = Encrypted<VaultStateString>

/**
 * Represents the static secret shared between a client and its sync server.
 *
 * A DEPLOYMENT gate, not a credential: every device that syncs with a server
 * holds the same value, so it says who may open a socket and nothing whatsoever
 * about which device is on the other end of one. See
 * key-hierarchy-review/16-server-authentication.md, which stays open for
 * exactly that reason.
 *
 * An opaque string, used as UTF-8 bytes for the HMAC key -- deliberately not
 * base64, so an operator can paste whatever their password manager produced.
 * It never crosses the wire: what travels is an HMAC over a server nonce, see
 * utils/connectAuth.mts.
 */
export type ServerSecret = Tagged<string, 'ServerSecret'>
