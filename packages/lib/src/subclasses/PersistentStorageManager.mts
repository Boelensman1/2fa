import { AuthenticationError } from '../FavaLibError.mjs'

import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  KdfParameters,
  MacKey,
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

import type FavaLibMediator from '../FavaLibMediator.mjs'
import type { FavaMeta } from '../interfaces/FavaMeta.mjs'
import type { PasswordExtraDict } from '../interfaces/PasswordExtraDict.js'
import type { SaveFunction } from '../interfaces/SaveFunction.mjs'
import type { DeviceId, VaultStateSend } from '../interfaces/SyncTypes.mjs'

import { validatePasswordStrength } from '../utils/creationUtils.mjs'
import { buildEnvelopeMacMessage, buildVaultAad } from '../utils/canonical.mjs'
import { LIB_VERSION, STORAGE_VERSION, V2_KDF_PARAMETERS } from '../version.mjs'

/**
 * Manages all storage of data that should be persistent.
 */
class PersistentStorageManager {
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
   * @param macKey - The envelope MAC key, derived from the password hash.
   * @param kdf - The argon2id parameters this vault's keys were derived with.
   * @param saveFunction - The function to save the data.
   */
  constructor(
    private mediator: FavaLibMediator,
    private readonly passwordExtraDict: PasswordExtraDict,
    private readonly favaMeta: FavaMeta,
    private readonly privateKey: PrivateKey,
    private readonly symmetricKey: SymmetricKey,
    private encryptedPrivateKey: EncryptedPrivateKey,
    private encryptedSymmetricKey: EncryptedSymmetricKey,
    private salt: Salt,
    private macKey: MacKey,
    private kdf: KdfParameters,
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
   * Builds the additional authenticated data for the vault state as stored at
   * rest.
   *
   * Always built from the CURRENT salt, kdf and encrypted private key. During
   * a storage version migration the atomic swap in replaceKeyMaterial has to
   * land before this is called, or the AAD is built from the old salt and the
   * blob authenticates against nothing.
   * @returns A promise resolving to the AAD string.
   */
  private async getAtRestAad(): Promise<string> {
    return buildVaultAad(
      STORAGE_VERSION,
      this.salt,
      this.kdf,
      await this.cryptoLib.sha256(this.encryptedPrivateKey),
    )
  }

  /**
   * Retrieves an encrypted representation of the library's current state.
   * This can be used for secure storage or transmission of the library's data.
   * @param key - The key to encrypt the vault state with. If not provided the library's current symmetric key will be used.
   * @param forDeviceId - If the vault is meant for a specific deviceId
   * @param aad - The additional authenticated data to bind the ciphertext to.
   * Deliberately required rather than defaulted: the at-rest context and the
   * three sync contexts must never be confused for one another, and a default
   * would make the wrong one the easy one to reach for.
   * @returns A promise that resolves with a string representation of the locked state.
   */
  async getEncryptedVaultState(
    key: SymmetricKey | undefined,
    forDeviceId: DeviceId | undefined,
    aad: string,
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
      aad,
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
    const encryptedVaultState = await this.getEncryptedVaultState(
      undefined,
      undefined,
      await this.getAtRestAad(),
    )

    const macFields = {
      libVersion: LIB_VERSION,
      storageVersion: STORAGE_VERSION,
      salt: this.salt,
      kdf: this.kdf,
      encryptedPrivateKey: this.encryptedPrivateKey,
      encryptedSymmetricKey: this.encryptedSymmetricKey,
      encryptedVaultState,
    }

    const lockedRepresentation: LockedRepresentation = {
      ...macFields,
      envelopeMac: await this.cryptoLib.createEnvelopeMac(
        this.macKey,
        buildEnvelopeMacMessage(macFields),
      ),
    }

    return JSON.stringify(lockedRepresentation) as LockedRepresentationString
  }

  /**
   * Replaces all password-derived key material at once, for the storage
   * version migration in loadFavaLibFromLockedRepesentation.
   *
   * One method rather than several setters because these five values are only
   * ever consistent together: the salt and the encrypted private key are AAD
   * and MAC inputs, and the MAC key is derived from the salt. Half a swap
   * produces a vault that saves successfully and never opens again.
   * @param salt - The new salt.
   * @param encryptedPrivateKey - The private key re-wrapped under the new password hash.
   * @param encryptedSymmetricKey - The symmetric key re-wrapped with the new OAEP hash.
   * @param macKey - The MAC key derived from the new password hash and salt.
   * @param kdf - The argon2id parameters used for the re-wrap.
   */
  replaceKeyMaterial(
    salt: Salt,
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    macKey: MacKey,
    kdf: KdfParameters,
  ): void {
    this.salt = salt
    this.encryptedPrivateKey = encryptedPrivateKey
    this.encryptedSymmetricKey = encryptedSymmetricKey
    this.macKey = macKey
    this.kdf = kdf
  }

  /**
   * Sets the save function for the library.
   * @param saveFunction - The save function to set.
   */
  public setSaveFunction(saveFunction: SaveFunction) {
    this.saveFunction = saveFunction
  }

  /**
   * Whether a save function is configured. The storage migration is skipped
   * without one, so that a consumer that only reads a vault (the fixture tests
   * being the case that matters) can never rewrite it.
   * @returns True when saving is possible.
   */
  public get canSave(): boolean {
    return Boolean(this.saveFunction)
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
      // this.kdf, not the v2 defaults: after a migration the two agree, but a
      // vault loaded at other parameters would otherwise fail every password
      // check with a correct password.
      await this.cryptoLib.decryptKeys(
        this.encryptedPrivateKey,
        this.encryptedSymmetricKey,
        salt,
        password,
        this.kdf,
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
      macKey: newMacKey,
    } = await this.cryptoLib.encryptKeys(
      this.privateKey,
      this.symmetricKey,
      this.salt,
      newPassword,
      V2_KDF_PARAMETERS,
    )

    // The salt is deliberately unchanged -- see
    // key-hierarchy-review/04-key-rotation.md, which owns rotation. What makes
    // this safe against a pre-change backup being spliced back in is that the
    // at-rest AAD binds a digest of encryptedPrivateKey, which is the one
    // field a password change does move.
    this.replaceKeyMaterial(
      this.salt,
      newEncryptedPrivateKey,
      newEncryptedSymmetricKey,
      newMacKey,
      V2_KDF_PARAMETERS,
    )

    await this.save()
  }
}

export default PersistentStorageManager
