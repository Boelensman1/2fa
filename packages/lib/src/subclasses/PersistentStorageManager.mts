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

import {
  generateSalt,
  validatePasswordStrength,
} from '../utils/creationUtils.mjs'
import { buildEnvelopeMacMessage, buildVaultAad } from '../utils/canonical.mjs'
import { LIB_VERSION, STORAGE_VERSION, V2_KDF_PARAMETERS } from '../version.mjs'
import { FavaLibEvent } from '../FavaLibEvent.mjs'

/**
 * Every value that a password change moves, in one object.
 *
 * These six are only ever consistent together: the salt feeds both the at-rest
 * AAD and the MAC key derivation, the encrypted private key is hashed into the
 * AAD, and the symmetric key is what the stored vault state is encrypted
 * under. Half a swap produces a vault that saves successfully and never opens
 * again, so they move as a unit -- and a unit that can be snapshotted and put
 * back, which is what makes the rollback in changePassword possible.
 */
interface VaultKeyMaterial {
  salt: Salt
  symmetricKey: SymmetricKey
  encryptedPrivateKey: EncryptedPrivateKey
  encryptedSymmetricKey: EncryptedSymmetricKey
  macKey: MacKey
  kdf: KdfParameters
}

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
   * Never rotated: peers hold this device's public key.
   * @param symmetricKey - The symmetric key the vault state is encrypted
   * under. An INITIAL value -- changePassword rotates it.
   * @param encryptedPrivateKey - The encrypted private key
   * @param encryptedSymmetricKey - The encrypted symmetric key
   * @param salt - The salt used for key derivation. An INITIAL value --
   * changePassword rotates it.
   * @param macKey - The envelope MAC key, derived from the password hash.
   * @param kdf - The argon2id parameters this vault's keys were derived with.
   * @param saveFunction - The function to save the data.
   */
  constructor(
    private mediator: FavaLibMediator,
    private readonly passwordExtraDict: PasswordExtraDict,
    private readonly favaMeta: FavaMeta,
    private readonly privateKey: PrivateKey,
    private symmetricKey: SymmetricKey,
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
  private get dispatchLibEvent() {
    return this.mediator.getComponent('dispatchLibEvent')
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
   * Takes the key material rather than reading this.* so that it cannot
   * disagree with the ciphertext it is meant to bind: its caller snapshots
   * once and passes the same generation here, to encryptSymmetric and into the
   * envelope. See getLockedRepresentation.
   * @param material - The key generation this AAD belongs to.
   * @returns A promise resolving to the AAD string.
   */
  private async getAtRestAad(material: VaultKeyMaterial): Promise<string> {
    return buildVaultAad(
      STORAGE_VERSION,
      material.salt,
      material.kdf,
      await this.cryptoLib.sha256(material.encryptedPrivateKey),
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
    // One snapshot, read synchronously, used for the AAD, the ciphertext, the
    // MAC fields and the MAC key alike. Reading this.* at each of the awaits
    // below would let a replaceKeyMaterial landing mid-save write an envelope
    // whose fields come from two generations -- a blob whose MAC verifies and
    // whose vault state then does not decrypt, with the previous one already
    // overwritten.
    const material = this.snapshotKeyMaterial()

    const encryptedVaultState = await this.getEncryptedVaultState(
      material.symmetricKey,
      undefined,
      await this.getAtRestAad(material),
    )

    const macFields = {
      libVersion: LIB_VERSION,
      storageVersion: STORAGE_VERSION,
      salt: material.salt,
      kdf: material.kdf,
      encryptedPrivateKey: material.encryptedPrivateKey,
      encryptedSymmetricKey: material.encryptedSymmetricKey,
      encryptedVaultState,
    }

    const lockedRepresentation: LockedRepresentation = {
      ...macFields,
      envelopeMac: await this.cryptoLib.createEnvelopeMac(
        material.macKey,
        buildEnvelopeMacMessage(macFields),
      ),
    }

    return JSON.stringify(lockedRepresentation) as LockedRepresentationString
  }

  /**
   * Reads the current key generation out as one value.
   *
   * Two callers, for the same underlying reason: getLockedRepresentation needs
   * every field of one envelope to come from one generation, and
   * changePassword needs somewhere to put the old generation so it can be
   * restored if the save fails.
   * @returns The six values as they stand now.
   */
  private snapshotKeyMaterial(): VaultKeyMaterial {
    return {
      salt: this.salt,
      symmetricKey: this.symmetricKey,
      encryptedPrivateKey: this.encryptedPrivateKey,
      encryptedSymmetricKey: this.encryptedSymmetricKey,
      macKey: this.macKey,
      kdf: this.kdf,
    }
  }

  /**
   * Replaces the whole key generation at once, for changePassword.
   *
   * One method taking one object rather than several setters, or six
   * arguments, because these values are only ever consistent together: the
   * salt and the encrypted private key are AAD and MAC inputs, the MAC key is
   * derived from the salt, and the symmetric key is what the stored vault
   * state is encrypted under. Half a swap produces a vault that saves
   * successfully and never opens again. The object form is also what lets a
   * snapshot be handed straight back on a failed save, rather than
   * reassembled by hand at the call site.
   *
   * Private: an outside caller reaching this through
   * favaLib.storage.persistentStorage cannot construct a consistent
   * generation -- producing a matching encryptedSymmetricKey needs the private
   * key -- so the only thing exposing it achieves is a permanently unopenable
   * vault.
   *
   * The v1 storage migration does not go through here: it builds its material
   * before the FavaLib exists (creationUtils.mts) and hands it to the
   * constructor already consistent.
   * @param material - The generation to install.
   */
  private replaceKeyMaterial(material: VaultKeyMaterial): void {
    this.salt = material.salt
    this.symmetricKey = material.symmetricKey
    this.encryptedPrivateKey = material.encryptedPrivateKey
    this.encryptedSymmetricKey = material.encryptedSymmetricKey
    this.macKey = material.macKey
    this.kdf = material.kdf
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
   * Changes the library's password, rotating the salt and the symmetric key
   * with it.
   *
   * Rotation is what makes this a revocation rather than a re-wrap. The
   * symmetric key encrypts every future save, so re-wrapping the old one
   * leaves anyone who ever unlocked this vault able to read what it writes
   * next; and grinding the old blob under the old salt would otherwise carry
   * straight over to the new one, which matters precisely because
   * changePassword is the post-compromise action. Both are free here: the
   * symmetric key is per-device and no peer has ever seen it, so nothing needs
   * coordinating and the storage format does not move.
   *
   * The RSA keypair is deliberately NOT rotated -- peers hold this device's
   * public key and the only channel for a new one is unauthenticated. See
   * key-hierarchy-review/04-key-rotation.md.
   *
   * On a failed save the previous generation is put back, so a caller that
   * sees this reject can tell the user their password is unchanged and be
   * right. Leaving the new generation in place instead would let the next
   * autosave commit a password the user was told had not been set.
   * @param oldPassword - The current password.
   * @param newPassword - The new password to set.
   * @returns A promise that resolves when the password change is complete.
   * @throws {AuthenticationError} If the provided old password is incorrect.
   * @fires FavaLibEvent.PasswordChanged
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

    // The entire new generation is derived before a single field moves, the
    // same way the v1 re-wrap does it in creationUtils: a half-applied swap
    // writes a vault that saves and never opens, and deriving up front makes
    // that state unrepresentable rather than merely avoided. encryptKeys
    // derives the password hash once and returns the MAC key from it, so this
    // costs one argon2id pass, not two.
    const salt = await generateSalt(this.cryptoLib)
    const symmetricKey = await this.cryptoLib.createSymmetricKey()
    const { encryptedPrivateKey, encryptedSymmetricKey, macKey } =
      await this.cryptoLib.encryptKeys(
        this.privateKey,
        symmetricKey,
        salt,
        newPassword,
        V2_KDF_PARAMETERS,
      )

    const previous = this.snapshotKeyMaterial()
    // Synchronous, and nothing awaits between here and the save: the vault
    // state is re-encrypted from plaintext on every save, so this swap alone
    // is what puts the stored blob under the new key with an AAD built from
    // the new salt.
    this.replaceKeyMaterial({
      salt,
      symmetricKey,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      macKey,
      kdf: V2_KDF_PARAMETERS,
    })

    try {
      await this.save()
    } catch (error) {
      this.replaceKeyMaterial(previous)
      throw error
    }

    // After the save, never before: a listener clearing a cached password must
    // not be able to act on a change that has not reached storage.
    this.dispatchLibEvent(FavaLibEvent.PasswordChanged)
  }
}

export default PersistentStorageManager
