import { InitializationError, AuthenticationError } from '../TwoFALibError.mjs'

import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
} from '../interfaces/CryptoLib.mjs'
import { Vault } from '../interfaces/Vault.mjs'

import type TwoFaLibMediator from '../TwoFaLibMediator.mjs'
import type { WasChangedSinceLastSave } from '../interfaces/WasChangedSinceLastSave.mjs'
import type { UserId } from '../interfaces/SyncTypes.mjs'

import { TwoFaLibEvent } from '../TwoFaLibEvent.mjs'

class PersistentStorageManager {
  private userId?: UserId
  private privateKey?: PrivateKey
  private encryptedPrivateKey?: EncryptedPrivateKey
  private encryptedSymmetricKey?: EncryptedSymmetricKey
  private symmetricKey?: SymmetricKey
  private salt?: Salt
  private wasChangedSinceLastSave: WasChangedSinceLastSave = {
    lockedRepresentation: true,
    encryptedPrivateKey: true,
    encryptedSymmetricKey: true,
    salt: true,
    userId: true,
    syncDevices: true,
  }

  constructor(private mediator: TwoFaLibMediator) {}

  private get cryptoLib() {
    return this.mediator.getLibraryLoader().getCryptoLib()
  }
  private get internalVaultManager() {
    return this.mediator.getInternalVaultManager()
  }
  private get syncManager() {
    return this.mediator.getSyncManager()
  }
  private get dispatchLibEvent() {
    return this.mediator.getDispatchLibEvent()
  }

  /**
   * Initialize the library with an encrypted private key and passphrase.
   * @param userId - The user ID used for identification.
   * @param encryptedPrivateKey - The encrypted private key used for secure operations.
   * @param encryptedSymmetricKey - The encrypted symmetric key used for secure operations.
   * @param salt - The salt used for key derivation.
   * @param passphrase - The passphrase to decrypt the private key.
   * @returns A promise that resolves with the private key, symmetric key and public key.
   * @throws {InitializationError} If initialization fails due to technical issues.
   * @throws {AuthenticationError} If the provided passphrase is incorrect.
   */
  async init(
    userId: UserId,
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    passphrase: Passphrase,
  ): Promise<{
    privateKey: PrivateKey
    symmetricKey: SymmetricKey
    publicKey: PublicKey
  }> {
    this.userId = userId
    const { privateKey, symmetricKey, publicKey } =
      await this.cryptoLib.decryptKeys(
        encryptedPrivateKey,
        encryptedSymmetricKey,
        salt,
        passphrase,
      )
    this.privateKey = privateKey
    this.symmetricKey = symmetricKey
    this.encryptedPrivateKey = encryptedPrivateKey
    this.encryptedSymmetricKey = encryptedSymmetricKey
    this.salt = salt
    this.wasChangedSinceLastSave = {
      lockedRepresentation: true,
      encryptedPrivateKey: true,
      encryptedSymmetricKey: true,
      salt: true,
      userId: true,
      syncDevices: true,
    }

    return { privateKey, symmetricKey, publicKey }
  }

  /**
   * Get a locked representation of the library's current state.
   * This can be used for secure storage or transmission of the library's data.
   * @param key - The key to encrypt the locked representation with. If not provided,
   *              the library's current symmetric key will be used.
   * @returns A promise that resolves with a string representation of the locked state.
   */
  async getLockedRepresentation(key?: SymmetricKey): Promise<string> {
    if (!this.symmetricKey) {
      throw new InitializationError('PublicKey missing')
    }
    return await this.cryptoLib.encryptSymmetric(
      key ?? this.symmetricKey,
      JSON.stringify(this.internalVaultManager.getAllEntries()),
    )
  }

  /**
   * Load the library state from a previously locked representation.
   * @param lockedRepresentation - The string representation of the locked state.
   * @param key - The key to decrypt the locked representation with. If not provided,
   *              the library's current symmetric key will be used.
   * @returns A promise that resolves when loading is complete.
   * @throws {InitializationError} If loading fails due to invalid or corrupted data.
   */
  async loadFromLockedRepresentation(
    lockedRepresentation: string,
    key?: SymmetricKey,
  ): Promise<void> {
    if (!this.symmetricKey) {
      throw new InitializationError('PrivateKey missing')
    }
    const newVault = JSON.parse(
      await this.cryptoLib.decryptSymmetric(
        key ?? this.symmetricKey,
        lockedRepresentation,
      ),
    ) as Vault
    this.internalVaultManager.replaceVault(newVault)
    this.dispatchLibEvent(TwoFaLibEvent.LoadedFromLockedRepresentation)
  }

  async save() {
    if (
      !this.encryptedPrivateKey ||
      !this.encryptedSymmetricKey ||
      !this.salt ||
      !this.userId
    ) {
      throw new InitializationError('Initialisation not completed')
    }

    const wasChangedSinceLastSaveCache = this.wasChangedSinceLastSave
    this.wasChangedSinceLastSave = {
      lockedRepresentation: false,
      encryptedPrivateKey: false,
      encryptedSymmetricKey: false,
      salt: false,
      userId: false,
      syncDevices: false,
    }
    const lockedRepresentation = await this.getLockedRepresentation()
    this.dispatchLibEvent(TwoFaLibEvent.Changed, {
      changed: wasChangedSinceLastSaveCache,
      data: {
        lockedRepresentation,
        encryptedPrivateKey: this.encryptedPrivateKey,
        encryptedSymmetricKey: this.encryptedSymmetricKey,
        salt: this.salt,
        userId: this.userId,
        syncDevices: JSON.stringify(this.syncManager?.syncDevices ?? []),
      },
    })
  }

  /**
   * Validate the provided passphrase against the current library passphrase.
   * @param salt - The salt used for key derivation.
   * @param passphrase - The passphrase to validate.
   * @returns A promise that resolves with a boolean indicating whether the passphrase is valid.
   */
  async validatePassphrase(
    salt: Salt,
    passphrase: Passphrase,
  ): Promise<boolean> {
    if (!this.encryptedPrivateKey)
      throw new InitializationError('EncryptedPrivateKey missing')
    if (!this.encryptedSymmetricKey)
      throw new InitializationError('EncryptedSymmetricKey missing')
    try {
      await this.cryptoLib.decryptKeys(
        this.encryptedPrivateKey,
        this.encryptedSymmetricKey,
        salt,
        passphrase,
      )
      return true
    } catch {
      return false
    }
  }

  /**
   * Change the library's passphrase.
   * @param oldPassphrase - The current passphrase.
   * @param newPassphrase - The new passphrase to set.
   * @returns A promise that resolves when the passphrase change is complete.
   * @throws {AuthenticationError} If the provided old passphrase is incorrect.
   */
  async changePassphrase(
    oldPassphrase: Passphrase,
    newPassphrase: Passphrase,
  ): Promise<void> {
    if (!this.privateKey) throw new InitializationError('PrivateKey missing')
    if (!this.symmetricKey)
      throw new InitializationError('SymmetricKey missing')
    if (!this.salt) throw new InitializationError('Salt missing')
    if (!this.userId) throw new InitializationError('Salt missing')

    const isValid = await this.validatePassphrase(this.salt, oldPassphrase)
    if (!isValid) throw new AuthenticationError('Invalid old passphrase')

    const {
      encryptedPrivateKey: newEncryptedPrivateKey,
      encryptedSymmetricKey: newEncryptedSymmetricKey,
    } = await this.cryptoLib.encryptKeys(
      this.privateKey,
      this.symmetricKey,
      this.salt,
      newPassphrase,
    )
    this.wasChangedSinceLastSave.encryptedPrivateKey = true
    this.wasChangedSinceLastSave.lockedRepresentation = true
    await this.init(
      this.userId,
      newEncryptedPrivateKey,
      newEncryptedSymmetricKey,
      this.salt,
      newPassphrase,
    )
    await this.save()
  }

  __updateWasChangedSinceLastSave(changed: (keyof WasChangedSinceLastSave)[]) {
    changed.forEach((change) => {
      this.wasChangedSinceLastSave[change] = true
    })
  }
}

export default PersistentStorageManager
