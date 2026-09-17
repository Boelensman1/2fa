import type { Tagged } from 'type-fest'
import type {
  Encrypted,
  EncryptedSymmetricKey,
  PublicKey,
  Signature,
  SigningPublicKey,
  SymmetricKey,
} from './BrandedTypes.mjs'
import type { KdfParameters } from '../utils/canonical.mjs'

export type {
  Encrypted,
  EncryptedPublicKeys,
  EncryptedSymmetricKey,
  PublicKey,
  PublicKeysString,
  Signature,
  SigningPublicKey,
  SymmetricKey,
} from './BrandedTypes.mjs'
export type { KdfParameters } from '../utils/canonical.mjs'

/** Represents a password  */
export type Password = Tagged<string, 'Password'>

/** Represents a passwordHash  */
export type PasswordHash = Tagged<string, 'PasswordHash'>

/** Represents a salt (base64 encoded) */
export type Salt = Tagged<string, 'Salt'>

/**
 * Represents a device's X25519 secret key (base64 encoded, 32 raw bytes).
 *
 * The key agreement half of the device's identity; the signing half is
 * SigningSecretKey. Neither is ever transmitted, and at rest the two are
 * sealed together as one `encryptedSecretKeys` envelope.
 */
export type PrivateKey = Tagged<string, 'PrivateKey'>

/** Represents a device's Ed25519 secret key (base64 encoded, 32 raw bytes) */
export type SigningSecretKey = Tagged<string, 'SigningSecretKey'>

/**
 * A device's two secret keys, which are only ever handled as a unit.
 *
 * They are created together, sealed together under one password-derived key,
 * and replaced together -- a device holding half of one generation and half of
 * another can neither be written to nor heard from by its peers.
 */
export interface DeviceSecretKeys {
  privateKey: PrivateKey
  signingSecretKey: SigningSecretKey
}

/** A device's two public keys, as its peers know it. */
export interface DevicePublicKeys {
  publicKey: PublicKey
  signingPublicKey: SigningPublicKey
}

/** Represents a sync (symmetric) key (base64 encoded) */
export type SyncKey = Tagged<SymmetricKey, 'SyncKey'>

/**
 * A device's sealed secret keys: an AES-256-GCM envelope over the JSON of both
 * of them, under a key derived from the password hash.
 */
export type EncryptedSecretKeys = Encrypted<SecretKeysString>

/** Represents the stringified form of a device's pair of secret keys */
export type SecretKeysString = Tagged<string, 'SecretKeysString'>

/**
 * Represents the key the envelope MAC is computed with (base64 encoded).
 * Derived from the password hash, never from the symmetric key -- that is the
 * whole point of it, see buildEnvelopeMacMessage.
 */
export type MacKey = Tagged<string, 'MacKey'>

/**
 * Interface for cryptographic operations.
 * The implementation in CryptoProviders/node is the reference implementation
 */
interface CryptoLib {
  /**
   * Get a number of cryptographically securely generated random bytes
   * @param count - The amount of bytes to generate
   * @returns A promise that resolves to the generated random bytes
   */
  getRandomBytes: (count: number) => Promise<Uint8Array>

  /**
   * Hashes a string with SHA-256.
   *
   * Used to fold the ~3.2 KB encrypted private key PEM into the vault AAD
   * without concatenating it on every save and every load. Hash the exact
   * stored bytes -- never a re-serialised or line-ending-normalised form.
   * @param data - The string to hash
   * @returns A promise that resolves to the base64 encoded digest
   */
  sha256: (data: string) => Promise<string>

  /**
   * Creates the keys required for further operations.
   *
   * A device gets two keypairs -- X25519 for key agreement, Ed25519 for
   * signatures -- and one symmetric key for its own vault state. All three are
   * sealed under keys derived from the password hash: there is no key wrapped
   * to the device's own public key any more. That self-wrap was what let anyone
   * holding the public key choose their own symmetric key and re-encrypt the
   * whole vault, which is the forgery `envelopeMac` had to be added to catch
   * (key-hierarchy-review/02-ciphertext-authenticity.md).
   * @param password - The password to derive the wrapping keys from
   * @returns A promise resolving to the key material, both sealed forms, the
   * salt, the envelope MAC key and the kdf parameters used
   */
  createKeys: (password: Password) => Promise<{
    privateKey: PrivateKey
    signingSecretKey: SigningSecretKey
    symmetricKey: SymmetricKey
    encryptedSecretKeys: EncryptedSecretKeys
    encryptedSymmetricKey: EncryptedSymmetricKey
    publicKey: PublicKey
    signingPublicKey: SigningPublicKey
    salt: Salt
    macKey: MacKey
    kdf: KdfParameters
  }>

  /**
   * Decrypts the keys required for further operations
   *
   * Returns the envelope MAC key alongside them, derived from the password
   * hash this call already computed. Deriving it separately would mean a second
   * argon2id pass -- ~260 ms at the v2 parameters, on every single unlock.
   * @param encryptedSecretKeys - The sealed secret keys
   * @param encryptedSymmetricKey - The sealed symmetric key
   * @param salt - The salt used for key derivation
   * @param password - The password the seals were made under
   * @param kdf - The argon2id parameters the vault was written with
   * @returns A promise resolving to both secret keys, both public keys (derived
   * rather than stored), the symmetric key and the envelope MAC key
   */
  decryptKeys: (
    encryptedSecretKeys: EncryptedSecretKeys,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    password: Password,
    kdf: KdfParameters,
  ) => Promise<{
    privateKey: PrivateKey
    signingSecretKey: SigningSecretKey
    symmetricKey: SymmetricKey
    publicKey: PublicKey
    signingPublicKey: SigningPublicKey
    macKey: MacKey
  }>

  /**
   * Seals the keys required for further operation under a password.
   * @param secretKeys - The device's two secret keys, sealed as a unit
   * @param symmetricKey - The symmetric key to seal
   * @param salt - The salt used for key derivation
   * @param password - The password to derive the wrapping keys from
   * @param kdf - The argon2id parameters to derive with
   * @returns A promise that resolves to both sealed forms and the envelope MAC key
   */
  encryptKeys: (
    secretKeys: DeviceSecretKeys,
    symmetricKey: SymmetricKey,
    salt: Salt,
    password: Password,
    kdf: KdfParameters,
  ) => Promise<{
    encryptedSecretKeys: EncryptedSecretKeys
    encryptedSymmetricKey: EncryptedSymmetricKey
    macKey: MacKey
  }>

  /**
   * Derives the envelope MAC key from a password hash.
   *
   * HKDF-SHA256 over the HEX-DECODED password hash -- 64 raw bytes, not the
   * 128 characters of the hex string. That distinction is part of the
   * cross-provider contract: both readings are plausible and they diverge
   * silently, so tests/CryptoProviders pins it.
   * @param passwordHash - The argon2id password hash (hex)
   * @param salt - The vault salt
   * @returns A promise that resolves to the derived MAC key
   */
  deriveEnvelopeMacKey: (
    passwordHash: PasswordHash,
    salt: Salt,
  ) => Promise<MacKey>

  /**
   * Computes the envelope MAC over a canonical message.
   * @param macKey - The key from deriveEnvelopeMacKey
   * @param message - The message from buildEnvelopeMacMessage
   * @returns A promise that resolves to the base64 encoded HMAC-SHA256
   */
  createEnvelopeMac: (macKey: MacKey, message: string) => Promise<string>

  /**
   * Verifies an envelope MAC in constant time.
   * @param macKey - The key from deriveEnvelopeMacKey
   * @param message - The message from buildEnvelopeMacMessage
   * @param mac - The base64 encoded MAC read from the stored vault
   * @returns A promise that resolves to whether the MAC is valid
   */
  verifyEnvelopeMac: (
    macKey: MacKey,
    message: string,
    mac: string,
  ) => Promise<boolean>

  /**
   * Seals a plain text message to a public key.
   *
   * X25519 from a keypair created for this one message to the recipient's
   * public key, HKDF-SHA256 over the shared secret, then AES-256-GCM. The
   * format is `v2:<ephemeral public key>:<nonce>:<ciphertext||tag>`, all
   * base64. Both public keys are bound into the HKDF info, which is why there
   * is no separate aad parameter.
   *
   * Sealing says nothing about WHO sealed it -- anyone can seal to a public
   * key, exactly as anyone could RSA-OAEP to one. Authenticity comes from
   * `sign`, and the two are deliberately separate calls so that no caller can
   * mistake one for the other.
   * @param publicKey - The recipient's X25519 public key
   * @param plainText - The text to seal
   * @returns A promise that resolves to the sealed text
   * @throws {CryptoError} If the public key is malformed
   */
  encrypt: <T extends string>(
    publicKey: PublicKey,
    plainText: T,
  ) => Promise<Encrypted<T>>

  /**
   * Opens a message sealed to this device's public key.
   * @param privateKey - This device's X25519 secret key
   * @param encryptedText - The sealed text
   * @returns A promise that resolves to the decrypted text
   * @throws {CryptoError} If the key is malformed or authentication fails, with
   * one uniform message for every cause.
   */
  decrypt: <T extends string>(
    privateKey: PrivateKey,
    encryptedText: Encrypted<T>,
  ) => Promise<T>

  /**
   * Signs a canonical message with this device's signing key.
   *
   * The counterpart of `verify`, and the primitive the whole sync path's
   * authenticity rests on: it is the only operation in the library that proves
   * possession of a secret which is never transmitted, and the only one whose
   * meaning ends the moment a device leaves the peer list.
   * @param signingSecretKey - This device's Ed25519 secret key
   * @param message - The canonical message to sign, built in canonical.mts
   * @returns A promise that resolves to the base64 encoded signature
   * @throws {CryptoError} If the signing key is malformed
   */
  sign: (
    signingSecretKey: SigningSecretKey,
    message: string,
  ) => Promise<Signature>

  /**
   * Verifies a signature made by a peer.
   *
   * Resolves false for every failure -- a bad signature, a malformed one, a
   * malformed key -- and never rejects. Its callers are deciding whether to
   * drop something that arrived from the network, where distinguishing the
   * causes is exactly the oracle the decrypt path refuses to be.
   * @param signingPublicKey - The claimed sender's Ed25519 public key
   * @param message - The canonical message the signature should cover
   * @param signature - The base64 encoded signature
   * @returns A promise that resolves to whether the signature is valid
   */
  verify: (
    signingPublicKey: SigningPublicKey,
    message: string,
    signature: Signature,
  ) => Promise<boolean>

  /**
   * Decrypts an encrypted message using a symmetric key
   * @param symmetricKey - The symmetric key to use for decryption
   * @param encryptedText - The text to decrypt
   * @param aad - The additional authenticated data the ciphertext was created with
   * @returns A promise that resolves to the decrypted text
   * @throws {CryptoError} If authentication fails, for any reason. One uniform
   * error: a decrypt that distinguishes its failure modes is an oracle.
   */
  decryptSymmetric: <T extends string>(
    symmetricKey: SymmetricKey,
    encryptedText: Encrypted<T>,
    aad: string,
  ) => Promise<T>

  /**
   * Encrypts a plain text message using a symmetric key
   * @param symmetricKey - The symmetric key to use for encryption
   * @param plainText - The text to encrypt
   * @param aad - The additional authenticated data to bind the ciphertext to
   * @returns A promise that resolves to the encrypted text
   */
  encryptSymmetric: <T extends string>(
    symmetricKey: SymmetricKey,
    plainText: T,
    aad: string,
  ) => Promise<Encrypted<T>>

  /**
   * Creates a random symmetric key
   * @returns A promise that resolves to the newly created symmetric key
   */
  createSymmetricKey: () => Promise<SymmetricKey>

  /**
   * Creates a sync key from a shared key (that was created from a JPAKE exchange)
   *
   * Uses SYNC_KDF_PARAMETERS rather than the password parameters: its input is
   * already a 256-bit ECC shared secret, so there is nothing to grind and the
   * cost setting is immaterial.
   * @param sharedKey - The shared key to derive from
   * @param salt - A salt to derive the key with
   * @returns A promise that resolves to the derived key
   */
  createSyncKey: (sharedKey: Uint8Array, salt: Salt) => Promise<SyncKey>
}

export default CryptoLib
