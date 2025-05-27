import type TwoFaLibMediator from '../TwoFaLibMediator.mjs'

import type { Passphrase } from '../interfaces/CryptoLib.mjs'

/**
 * Manages the public operations related to the vault storage
 */
class StorageOperationsManager {
  /**
   * Constructs a new instance of StorageOperationsManager.
   * @param mediator - The mediator for accessing other components.
   */
  constructor(private readonly mediator: TwoFaLibMediator) {}

  /**
   * @returns The persistent storage manager instance which can be used to store data.
   */
  get persistentStorage() {
    return this.mediator.getComponent('persistentStorageManager')
  }

  /**
   * Forces a save.
   */
  async forceSave() {
    return this.persistentStorage.save()
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
    return this.persistentStorage.changePassphrase(oldPassphrase, newPassphrase)
  }
}

export default StorageOperationsManager
