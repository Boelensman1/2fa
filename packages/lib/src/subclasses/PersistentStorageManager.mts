import { AuthenticationError } from '../TwoFALibError.mjs'

import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
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
import type { DeviceId } from '../interfaces/SyncTypes.mjs'
import type { PassphraseExtraDict } from '../interfaces/PassphraseExtraDict.js'

import { TwoFaLibEvent } from '../TwoFaLibEvent.mjs'
import TwoFaLib from '../TwoFaLib.mjs'
import { validatePassphraseStrength } from '../utils/creationUtils.mjs'

/**
 * Manages all storage of data that should be persistent.
 */
class PersistentStorageManager {
  public static readonly storageVersion = 1

  /**
   * Constructs a new instance of PersistentStorageManager.
   * @param mediator - The mediator for accessing other components.
   * @param passphraseExtraDict - Additional words to be used for passphrase strength evaluation.
   * @param deviceId - The unique identifier of the device.
   * @param privateKey - The private key used for cryptographic operations.
   * @param symmetricKey - The symmetric key used for cryptographic operations.
   * @param encryptedPrivateKey - The encrypted private key
   * @param encryptedSymmetricKey - The encrypted symmetric key
   * @param salt - The salt used for key derivation.
   */
  constructor(
    private mediator: TwoFaLibMediator,
    private readonly passphraseExtraDict: PassphraseExtraDict,
    private readonly deviceId: DeviceId,
    private readonly privateKey: PrivateKey,
    private readonly symmetricKey: SymmetricKey,
    private encryptedPrivateKey: EncryptedPrivateKey,
    private encryptedSymmetricKey: EncryptedSymmetricKey,
    private salt: Salt,
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
  private get dispatchLibEvent() {
    return this.mediator.getComponent('dispatchLibEvent')
  }

  /**
   * Retrieves an encrypted representation of the library's current state.
   * This can be used for secure storage or transmission of the library's data.
   * @param key - The key to decrypt the locked representation with. If not provided the library's current symmetric key will be used.
   * @returns A promise that resolves with a string representation of the locked state.
   */
  async getEncryptedVaultState(
    key?: SymmetricKey,
  ): Promise<EncryptedVaultStateString> {
    const vault = this.vaultDataManager.getAllEntries()

    const vaultState: VaultState = {
      vault,
      syncDevices: this.syncManager?.syncDevices ?? [],
      deviceId: this.deviceId,
    }

    return await this.cryptoLib.encryptSymmetric(
      key ?? this.symmetricKey,
      JSON.stringify(vaultState) as VaultStateString,
    )
  }

  /**
   * Creates a partially encrypted representation of all data, except for
   * the passphrase, that is needed to load the library. This can be used
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
   * Saves the current state of the library.
   * @returns A promise that resolves when the save operation is complete.
   */
  public async save() {
    const lockedRepresentation = await this.getLockedRepresentation()
    this.dispatchLibEvent(TwoFaLibEvent.Changed, {
      newLockedRepresentationString: lockedRepresentation,
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
    await validatePassphraseStrength(
      this.mediator.getComponent('libraryLoader'),
      newPassphrase,
      this.passphraseExtraDict,
    )

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

    this.encryptedPrivateKey = newEncryptedPrivateKey
    this.encryptedSymmetricKey = newEncryptedSymmetricKey

    await this.save()
  }
}

export default PersistentStorageManager
