import type { Tagged } from 'type-fest'
import type {
  Encrypted,
  EncryptedSymmetricKey,
  PublicKey,
  SymmetricKey,
} from './BrandedTypes.mjs'
import type { KdfParameters } from '../utils/canonical.mjs'

export type {
  Encrypted,
  EncryptedPublicKey,
  EncryptedSymmetricKey,
  PublicKey,
  SymmetricKey,
} from './BrandedTypes.mjs'
export type { KdfParameters } from '../utils/canonical.mjs'

/** Represents a password  */
export type Password = Tagged<string, 'Password'>

/** Represents a passwordHash  */
export type PasswordHash = Tagged<string, 'PasswordHash'>

/** Represents a salt (base64 encoded) */
export type Salt = Tagged<string, 'Salt'>

/** Represents a private key */
export type PrivateKey = Tagged<string, 'PrivateKey'>

/** Represents a sync (symmetric) key (base64 encoded) */
export type SyncKey = Tagged<SymmetricKey, 'SyncKey'>

/** Represents an encrypted private key (base64 encoded) */
export type EncryptedPrivateKey = Encrypted<PrivateKey>

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
   * It first creates a public/private key pair, with the private key being encrypted using the password.
   * It then generates a symmetricKey. It will then encrypt this symmetricKey using the generated public key.
   * @param password - The password to encrypt the private key with
   * @returns A promise that resolves to an object containing the encrypted private key, encrypted symmetric key, public key and envelope MAC key
   */
  createKeys: (password: Password) => Promise<{
    privateKey: PrivateKey
    symmetricKey: SymmetricKey
    encryptedPrivateKey: EncryptedPrivateKey
    encryptedSymmetricKey: EncryptedSymmetricKey
    publicKey: PublicKey
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
   * @param encryptedPrivateKey - The encrypted private key
   * @param encryptedSymmetricKey - The encrypted symmetric key
   * @param salt - The salt used for key derivation
   * @param password - The password to decrypt the private key with
   * @param kdf - The argon2id parameters the vault was written with
   * @returns A promise that resolves to an object containing the decrypted private, symmetric and public key, and the envelope MAC key
   */
  decryptKeys: (
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    password: Password,
    kdf: KdfParameters,
  ) => Promise<{
    privateKey: PrivateKey
    symmetricKey: SymmetricKey
    publicKey: PublicKey
    macKey: MacKey
  }>

  /**
   * Decrypts the keys of a storage version 1 vault.
   *
   * MIGRATION PATH ONLY. This is the one place in the library that still
   * derives with the v1 argon2id parameters and unwraps with RSA-OAEP/
   * MGF1-SHA-1, and it must stay reachable only from
   * loadFavaLibFromLockedRepesentation -- no sync code may call it. There is no
   * MAC key, because a v1 envelope carries no MAC. Delete this together with
   * LEGACY_STORAGE_VERSION once installs have upgraded.
   * @param encryptedPrivateKey - The encrypted private key
   * @param encryptedSymmetricKey - The encrypted symmetric key
   * @param salt - The salt used for key derivation
   * @param password - The password to decrypt the private key with
   * @returns A promise that resolves to an object containing the decrypted private, symmetric and public key
   */
  decryptKeysV1: (
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    password: Password,
  ) => Promise<{
    privateKey: PrivateKey
    symmetricKey: SymmetricKey
    publicKey: PublicKey
  }>

  /**
   * Encrypts the keys required for further operation
   * @param privateKey - The private key to encrypt
   * @param symmetricKey - The symmetric key to encrypt
   * @param salt - The salt used for key derivation
   * @param password - The password to encrypt the private key with
   * @param kdf - The argon2id parameters to derive with
   * @returns A promise that resolves to an object containing the encrypted private key, encrypted symmetric key and envelope MAC key
   */
  encryptKeys: (
    privateKey: PrivateKey,
    symmetricKey: SymmetricKey,
    salt: Salt,
    password: Password,
    kdf: KdfParameters,
  ) => Promise<{
    encryptedPrivateKey: EncryptedPrivateKey
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
   * Encrypts a plain text message using a public key
   * @param publicKey - The public key to use for encryption
   * @param plainText - The text to encrypt
   * @returns A promise that resolves to the encrypted text (base64 encoded)
   */
  encrypt: <T extends string>(
    publicKey: PublicKey,
    plainText: T,
  ) => Promise<Encrypted<T>>

  /**
   * Decrypts an encrypted message using a private key
   * @param privateKey - The (unencrypted!) private key to use for decryption
   * @param encryptedText - The text to decrypt
   * @returns A promise that resolves to the decrypted text
   */
  decrypt: <T extends string>(
    privateKey: PrivateKey,
    encryptedText: Encrypted<T>,
  ) => Promise<T>

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
   * Decrypts a storage version 1 (AES-256-CBC, unauthenticated) ciphertext.
   *
   * MIGRATION PATH ONLY, exactly like decryptKeysV1: reachable from the vault
   * load path and from nowhere else. Keeping it off the sync path is what
   * actually removes the padding oracle described in
   * key-hierarchy-review/02-ciphertext-authenticity.md, rather than merely
   * making the new path safe.
   * @param symmetricKey - The symmetric key to use for decryption
   * @param encryptedText - The v1 text to decrypt
   * @returns A promise that resolves to the decrypted text
   */
  decryptSymmetricV1: <T extends string>(
    symmetricKey: SymmetricKey,
    encryptedText: Encrypted<T>,
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
   * Deliberately still at the v1 argon2id parameters: its input is already a
   * 256-bit ECC shared secret, so the cost setting is immaterial.
   * @param sharedKey - The shared key to derive from
   * @param salt - A salt to derive the key with
   * @returns A promise that resolves to the derived key
   */
  createSyncKey: (sharedKey: Uint8Array, salt: Salt) => Promise<SyncKey>
}

export default CryptoLib
