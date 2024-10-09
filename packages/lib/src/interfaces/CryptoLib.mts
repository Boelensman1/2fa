import { Tagged } from 'type-fest'

// `Encrypted<T>` tags the original string type to denote that is encrypted
export type Encrypted<T extends string> = Tagged<T, 'Encrypted'>

/** Represents a passphrase  */
export type Passphrase = Tagged<string, 'Passphrase'>

/** Represents a passphraseHash  */
export type PassphraseHash = Tagged<string, 'PassphraseHash'>

/** Represents a salt (base64 encoded) */
export type Salt = Tagged<string, 'Salt'>

/** Represents a private key */
export type PrivateKey = Tagged<string, 'PrivateKey'>

/** Represents a public key */
export type PublicKey = Tagged<string, 'PublicKey'>

/** Represents an symmetric key */
export type SymmetricKey = Tagged<string, 'SymmetricKey'>

/** Represents a sync (symmetric) key (base64 encoded) */
export type SyncKey = Tagged<SymmetricKey, 'SyncKey'>

/** Represents an encrypted private key (base64 encoded) */
export type EncryptedPrivateKey = Encrypted<PrivateKey>

/** Represents an encrypted symmetric key (base64 encoded) */
export type EncryptedSymmetricKey = Encrypted<SymmetricKey>

/** Represents an encrypted public key (base64 encoded) */
export type EncryptedPublicKey = Encrypted<PublicKey>

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
   * Creates the keys required for further operations.
   * It first creates a public/private key pair, with the private key being encrypted using the passphrase.
   * It then generates a symmetricKey. It will then encrypt this symmetricKey using the generated public key.
   * @param passphrase - The passphrase to encrypt the private key with
   * @returns A promise that resolves to an object containing the encrypted private key, encrypted symmetric key and public key
   */
  createKeys: (passphrase: Passphrase) => Promise<{
    encryptedPrivateKey: EncryptedPrivateKey
    encryptedSymmetricKey: EncryptedSymmetricKey
    publicKey: PublicKey
    salt: Salt
  }>

  /**
   * Decrypts the keys required for further operations
   * @param encryptedPrivateKey - The encrypted private key
   * @param encryptedSymmetricKey - The encrypted symmetric key
   * @param passphrase - The passphrase to decrypt the private key with
   * @returns A promise that resolves to an object containing the decrypted private, symmetric and public key
   */
  decryptKeys: (
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    passphrase: Passphrase,
  ) => Promise<{
    privateKey: PrivateKey
    symmetricKey: SymmetricKey
    publicKey: PublicKey
  }>

  /**
   * Encrypts the keys required for further operation
   * @param privateKey - The private key to encrypt
   * @param symmetricKey - The symmetric key to encrypt
   * @param passphrase - The passphrase to encrypt the private key with
   * @returns A promise that resolves to an object containing the encrypted private and symmetricKey key
   */
  encryptKeys: (
    privateKey: PrivateKey,
    symmetricKey: SymmetricKey,
    salt: Salt,
    passphrase: Passphrase,
  ) => Promise<{
    encryptedPrivateKey: EncryptedPrivateKey
    encryptedSymmetricKey: EncryptedSymmetricKey
  }>

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
   * @returns A promise that resolves to the decrypted text
   */
  decryptSymmetric: <T extends string>(
    symmetricKey: SymmetricKey,
    encryptedText: Encrypted<T>,
  ) => Promise<T>

  /**
   * Encrypts a plain text message using a symmetric key
   * @param symmetricKey - The symmetric key to use for encryption
   * @param plainText - The text to encrypt
   * @returns A promise that resolves to the encrypted text (base64 encoded)
   */
  encryptSymmetric: <T extends string>(
    symmetricKey: SymmetricKey,
    plainText: T,
  ) => Promise<Encrypted<T>>

  /**
   * Creates a random symmetric key
   * @returns A promise that resolves to the newly created symmetric key
   */
  createSymmetricKey: () => Promise<SymmetricKey>

  /**
   * Creates a sync key from a shared key (that was created from a JPAKE exchange)
   * @param sharedKey - The shared key to derive from
   * @param salt - A salt to derive the key with
   * @returns A promise that resolves to the derived key
   */
  createSyncKey: (sharedKey: Uint8Array, salt: Salt) => Promise<SyncKey>
}

export default CryptoLib
