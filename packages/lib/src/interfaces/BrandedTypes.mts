import type { Tagged } from 'type-fest'

/** Represents a device id */
export type DeviceId = Tagged<string, 'DeviceId'>

/**
 * Represents a device's key agreement public key: X25519 ++ ML-KEM-768,
 * concatenated in that order and base64 encoded (1216 raw bytes).
 *
 * The KEY AGREEMENT half of a device's identity: what a peer seals a message
 * to. The signing half is SigningPublicKey, and the two are deliberately
 * separate types -- a brand is what tells them apart at a call site, and it
 * matters more than the length does even though the two lengths now differ.
 *
 * Hybrid because X25519 alone is a discrete-log problem and a recorded seal
 * would decrypt retroactively once that falls; see
 * `platformProviders/shared/asymmetric.mts` for the full argument.
 *
 * Not versioned in itself. Every surface a key travels on carries a version of
 * its own (storageVersion in the vault, pairingVersion in a pairing payload,
 * version in a command), so a tag here would be a second source of truth that
 * could only ever disagree with the first.
 */
export type PublicKey = Tagged<string, 'PublicKey'>

/**
 * Represents a device's signing public key: Ed25519 ++ ML-DSA-65, concatenated
 * in that order and base64 encoded (1984 raw bytes).
 */
export type SigningPublicKey = Tagged<string, 'SigningPublicKey'>

/**
 * A device's key fingerprint: a short, human-comparable digest of both of its
 * public keys.
 *
 * Rendered rather than raw, because its only consumer is a person reading it
 * off one screen and checking it against another. See
 * `utils/deviceFingerprint.mts` for the derivation and for why it is this long.
 */
export type DeviceFingerprint = Tagged<string, 'DeviceFingerprint'>

/**
 * Represents a composite signature: Ed25519 ++ ML-DSA-65, concatenated in that
 * order and base64 encoded (3373 raw bytes). Both halves must verify.
 */
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
 * about which device is on the other end of one.
 *
 * An opaque string, used as UTF-8 bytes for the HMAC key -- deliberately not
 * base64, so an operator can paste whatever their password manager produced.
 * It never crosses the wire: what travels is an HMAC over a server nonce, see
 * utils/connectAuth.mts.
 */
export type ServerSecret = Tagged<string, 'ServerSecret'>
