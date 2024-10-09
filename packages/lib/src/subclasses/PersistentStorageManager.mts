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
import { EncryptedVaultData, Vault, VaultData } from '../interfaces/Vault.mjs'

import type TwoFaLibMediator from '../TwoFaLibMediator.mjs'
import type { DeviceId } from '../interfaces/SyncTypes.mjs'
import type { ChangedEventWasChangedSinceLastEvent } from '../interfaces/Events.mjs'

import { TwoFaLibEvent } from '../TwoFaLibEvent.mjs'

/**
 * Manages all storage of data that should be persistent.
 */
class PersistentStorageManager {
  private deviceId?: DeviceId
  private privateKey?: PrivateKey
  private encryptedPrivateKey?: EncryptedPrivateKey
  private encryptedSymmetricKey?: EncryptedSymmetricKey
  private symmetricKey?: SymmetricKey
  private salt?: Salt
  private wasChangedSinceLastSave: ChangedEventWasChangedSinceLastEvent = {
    lockedRepresentation: true,
    encryptedPrivateKey: true,
    encryptedSymmetricKey: true,
    salt: true,
    deviceId: true,
    syncDevices: true,
  }

  /**
   * Constructs a new instance of PersistentStorageManager.
   * @param mediator - The mediator for accessing other components.
   */
  constructor(private mediator: TwoFaLibMediator) {}

  private get cryptoLib() {
    return this.mediator.getComponent('libraryLoader').getCryptoLib()
  }
  private get vaultDatManager() {
    return this.mediator.getComponent('vaultDataManager')
  }
  private get syncManager() {
    if (!this.mediator.componentIsInitialised('syncManager')) {
      return null
    }
    return this.mediator.getComponent('syncManager')
  }
  private get dispatchLibEvent() {
    return this.mediator.getComponent('dispatchLibEvent')
  }

  /**
   * Initializes the storage manager with the provided keys and parameters.
   * @param deviceId - The unique identifier for the device.
   * @param encryptedPrivateKey - The encrypted private key.
   * @param encryptedSymmetricKey - The encrypted symmetric key.
   * @param salt - The salt used for key derivation.
   * @param passphrase - The passphrase for decrypting the keys.
   * @returns A promise that resolves with the decrypted private key, symmetric key, and public key.
   */
  async init(
    deviceId: DeviceId,
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    passphrase: Passphrase,
  ): Promise<{
    privateKey: PrivateKey
    symmetricKey: SymmetricKey
    publicKey: PublicKey
  }> {
    this.deviceId = deviceId
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
      deviceId: true,
      syncDevices: true,
    }

    return { privateKey, symmetricKey, publicKey }
  }

  /**
   * Retrieves a locked representation of the library's current state.
   * This can be used for secure storage or transmission of the library's data.
   * @param key - The key to encrypt the locked representation with. If not provided,
   *              the library's current symmetric key will be used.
   * @returns A promise that resolves with a string representation of the locked state.
   */
  async getLockedRepresentation(
    key?: SymmetricKey,
  ): Promise<EncryptedVaultData> {
    if (!this.symmetricKey) {
      throw new InitializationError('PublicKey missing')
    }
    return await this.cryptoLib.encryptSymmetric(
      key ?? this.symmetricKey,
      JSON.stringify(this.vaultDatManager.getAllEntries()) as VaultData,
    )
  }

  /**
   * Loads the library state from a previously locked representation.
   * @param lockedRepresentation - The string representation of the locked state.
   * @param key - The key to decrypt the locked representation with. If not provided,
   *              the library's current symmetric key will be used.
   * @returns A promise that resolves when loading is complete.
   * @throws {InitializationError} If loading fails due to invalid or corrupted data.
   */
  async loadFromLockedRepresentation(
    lockedRepresentation: EncryptedVaultData,
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
    this.vaultDatManager.replaceVault(newVault)
    this.dispatchLibEvent(TwoFaLibEvent.LoadedFromLockedRepresentation)
  }

  /**
   * Saves the current state of the library.
   * @returns A promise that resolves when the save operation is complete.
   * @throws {InitializationError} If the initialization is not completed.
   */
  async save() {
    if (
      !this.encryptedPrivateKey ||
      !this.encryptedSymmetricKey ||
      !this.salt ||
      !this.deviceId
    ) {
      throw new InitializationError('Initialisation not completed')
    }

    const wasChangedSinceLastSaveCache = this.wasChangedSinceLastSave
    this.wasChangedSinceLastSave = {
      lockedRepresentation: false,
      encryptedPrivateKey: false,
      encryptedSymmetricKey: false,
      salt: false,
      deviceId: false,
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
        deviceId: this.deviceId,
        syncDevices: JSON.stringify(this.syncManager?.syncDevices ?? []),
      },
    })
  }

  /**
   * Validates the provided passphrase against the current library passphrase.
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
   * Changes the library's passphrase.
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
    if (!this.deviceId) throw new InitializationError('Salt missing')

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
      this.deviceId,
      newEncryptedPrivateKey,
      newEncryptedSymmetricKey,
      this.salt,
      newPassphrase,
    )
    await this.save()
  }

  /**
   * Updates the state indicating which properties have changed since the last save.
   * @param changed - An array of keys indicating which properties have changed.
   */
  __updateWasChangedSinceLastSave(
    changed: (keyof ChangedEventWasChangedSinceLastEvent)[],
  ) {
    changed.forEach((change) => {
      this.wasChangedSinceLastSave[change] = true
    })
  }
}

export default PersistentStorageManager
