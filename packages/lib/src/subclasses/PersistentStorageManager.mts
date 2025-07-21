import { AuthenticationError } from '../TwoFALibError.mjs'

import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Password,
  PrivateKey,
  Salt,
  SymmetricKey,
} from '../interfaces/CryptoLib.mjs'
import {
  EncryptedVaultStateString,
  LockedRepresentation,
  LockedRepresentationString,
  VaultState,
  VaultStateString,
} from '../interfaces/Vault.mjs'

import type TwoFaLibMediator from '../TwoFaLibMediator.mjs'
import type { FavaMeta } from '../interfaces/FavaMeta.mjs'
import type { PasswordExtraDict } from '../interfaces/PasswordExtraDict.js'
import type { SaveFunction } from '../interfaces/SaveFunction.mjs'
import type { DeviceId, VaultStateSend } from '../interfaces/SyncTypes.mjs'

import TwoFaLib from '../TwoFaLib.mjs'
import { validatePasswordStrength } from '../utils/creationUtils.mjs'

/**
 * Manages all storage of data that should be persistent.
 */
class PersistentStorageManager {
  public static readonly storageVersion = 1
  private savePromise: Promise<void> | null = null

  /**
   * Constructs a new instance of PersistentStorageManager.
   * @param mediator - The mediator for accessing other components.
   * @param passwordExtraDict - Additional words to be used for password strength evaluation.
   * @param favaMeta - Meta info containing at least a unique identifier for this device.
   * @param privateKey - The private key used for cryptographic operations.
   * @param symmetricKey - The symmetric key used for cryptographic operations.
   * @param encryptedPrivateKey - The encrypted private key
   * @param encryptedSymmetricKey - The encrypted symmetric key
   * @param salt - The salt used for key derivation.
   * @param saveFunction - The function to save the data.
   */
  constructor(
    private mediator: TwoFaLibMediator,
    private readonly passwordExtraDict: PasswordExtraDict,
    private readonly favaMeta: FavaMeta,
    private readonly privateKey: PrivateKey,
    private readonly symmetricKey: SymmetricKey,
    private encryptedPrivateKey: EncryptedPrivateKey,
    private encryptedSymmetricKey: EncryptedSymmetricKey,
    private salt: Salt,
    private saveFunction?: SaveFunction,
  ) {}

  private get cryptoLib() {
    return this.mediator.getComponent('libraryLoader').getCryptoLib()
  }
  private get vaultDataManager() {
    return this.mediator.getComponent('vaultDataManager')
  }
  private get syncManager() {
    if (!this.mediator.componentIsInitialised('syncManager')) {
      return null
    }
    return this.mediator.getComponent('syncManager')
  }

  /**
   * Retrieves an encrypted representation of the library's current state.
   * This can be used for secure storage or transmission of the library's data.
   * @param key - The key to decrypt the locked representation with. If not provided the library's current symmetric key will be used.
   * @param forDeviceId - If the vault is meant for a specific deviceId
   * @returns A promise that resolves with a string representation of the locked state.
   */
  async getEncryptedVaultState(
    key?: SymmetricKey,
    forDeviceId?: DeviceId,
  ): Promise<EncryptedVaultStateString> {
    const vault = this.vaultDataManager.getAllEntries()

    const vaultState: VaultState | VaultStateSend = {
      vault,
      deviceId: this.favaMeta.deviceId,
      forDeviceId,
      deviceFriendlyName: this.favaMeta.deviceFriendlyName,
      sync: {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        devices: this.syncManager ? this.syncManager['syncDevices'] : [],
        serverUrl: this.syncManager?.serverUrl,
        commandSendQueue: this.syncManager?.getCommandSendQueue() ?? [],
      },
    }

    return await this.cryptoLib.encryptSymmetric(
      key ?? this.symmetricKey,
      JSON.stringify(vaultState) as VaultStateString,
    )
  }

  /**
   * Creates a partially encrypted representation of all data, except for
   * the password, that is needed to load the library. This can be used
   * for secure storage of the library's data.
   * @returns A promise that resolves with a json encoded string of
   * the partially encrypted library's data.
   */
  async getLockedRepresentation(): Promise<LockedRepresentationString> {
    const encryptedVaultState = await this.getEncryptedVaultState()

    const lockedRepresentation: LockedRepresentation = {
      libVersion: TwoFaLib.version,
      storageVersion: PersistentStorageManager.storageVersion,
      encryptedPrivateKey: this.encryptedPrivateKey,
      encryptedSymmetricKey: this.encryptedSymmetricKey,
      salt: this.salt,
      encryptedVaultState: encryptedVaultState,
    }

    return JSON.stringify(lockedRepresentation) as LockedRepresentationString
  }

  /**
   * Sets the save function for the library.
   * @param saveFunction - The save function to set.
   */
  public setSaveFunction(saveFunction: SaveFunction) {
    this.saveFunction = saveFunction
  }

  /**
   * Saves the current state of the library.
   * @returns A promise that resolves when the save operation is complete.
   */
  public async save() {
    if (this.saveFunction) {
      // If a save is already in progress, wait for it to complete
      if (this.savePromise) {
        await this.savePromise
        // recurse
        await this.save()
        return
      }

      // Start a new save operation
      this.savePromise = this.performSave()

      try {
        await this.savePromise
      } finally {
        this.savePromise = null
      }
    }
  }

  /**
   * Internal method to perform the actual save operation.
   */
  private async performSave(): Promise<void> {
    const lockedRepresentation = await this.getLockedRepresentation()
    await this.saveFunction!(lockedRepresentation)
  }

  /**
   * Validates the provided password against the current library password.
   * @param salt - The salt used for key derivation.
   * @param password - The password to validate.
   * @returns A promise that resolves with a boolean indicating whether the password is valid.
   */
  async validatePassword(salt: Salt, password: Password): Promise<boolean> {
    try {
      await this.cryptoLib.decryptKeys(
        this.encryptedPrivateKey,
        this.encryptedSymmetricKey,
        salt,
        password,
      )
      return true
    } catch {
      return false
    }
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
    await validatePasswordStrength(
      this.mediator.getComponent('libraryLoader'),
      this.passwordExtraDict,
      newPassword,
    )

    const isValid = await this.validatePassword(this.salt, oldPassword)
    if (!isValid) throw new AuthenticationError('Invalid old password')

    const {
      encryptedPrivateKey: newEncryptedPrivateKey,
      encryptedSymmetricKey: newEncryptedSymmetricKey,
    } = await this.cryptoLib.encryptKeys(
      this.privateKey,
      this.symmetricKey,
      this.salt,
      newPassword,
    )

    this.encryptedPrivateKey = newEncryptedPrivateKey
    this.encryptedSymmetricKey = newEncryptedSymmetricKey

    await this.save()
  }
}

export default PersistentStorageManager
