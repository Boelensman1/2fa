import type FavaLibMediator from '../FavaLibMediator.mjs'

import type { Password } from '../interfaces/CryptoLib.mjs'
import type { SaveFunction } from '../interfaces/SaveFunction.mjs'
import type { UnlockedSessionString } from '../interfaces/Vault.mjs'

/**
 * Manages the public operations related to the vault storage
 */
class StorageOperationsManager {
  /**
   * Constructs a new instance of StorageOperationsManager.
   * @param mediator - The mediator for accessing other components.
   */
  constructor(private readonly mediator: FavaLibMediator) {}

  /**
   * @returns The persistent storage manager instance which can be used to store data.
   */
  get persistentStorage() {
    return this.mediator.getComponent('persistentStorageManager')
  }

  /**
   * Forces a save.
   * @returns void
   */
  async forceSave() {
    return this.persistentStorage.save()
  }

  /**
   * Exports the derived key material of this unlocked vault, so it can be
   * rehydrated later without the password.
   *
   * The returned string is PLAINTEXT KEY MATERIAL and belongs only in
   * memory-backed, process-lifetime storage. Read
   * PersistentStorageManager.exportUnlockedSession's doc comment before using
   * it, and key-hierarchy-review/07-session-key-api.md before changing it.
   * @returns The session as a json string, for
   * loadFavaLibFromUnlockedSession.
   */
  public exportUnlockedSession(): UnlockedSessionString {
    return this.persistentStorage.exportUnlockedSession()
  }

  /**
   * Changes the library's password.
   * @param oldPassword - The current password.
   * @param newPassword - The new password to set.
   * @returns A promise that resolves when the password change is complete.
   * @throws {AuthenticationError} If the provided old password is incorrect.
   */
  async changePassword(
    oldPassword: Password,
    newPassword: Password,
  ): Promise<void> {
    return this.persistentStorage.changePassword(oldPassword, newPassword)
  }

  /**
   * Sets the save function for the library.
   * @param saveFunction - The save function to set.
   */
  public setSaveFunction(saveFunction: SaveFunction) {
    this.persistentStorage.setSaveFunction(saveFunction)
  }
}

export default StorageOperationsManager
