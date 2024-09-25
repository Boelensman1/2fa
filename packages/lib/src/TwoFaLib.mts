import type CryptoLib from './interfaces/CryptoLib.js'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  PrivateKey,
  Salt,
  SymmetricKey,
} from './interfaces/CryptoLib.js'

import { InitializationError, AuthenticationError } from './TwoFALibError.mjs'
import { SaveFunction } from './interfaces/SaveFunction.js'
import { WasChangedSinceLastSave } from './interfaces/WasChangedSinceLastSave.js'
import { Vault } from './interfaces/Vault.js'

import SyncManager from './SyncManager.mjs'
import LibraryLoader from './LibraryLoader.mjs'
import VaultManager from './VaultManager.js'
import ExportImportManager from './ExportImportManager.mjs'

/**
 * Two-Factor Authentication Library
 * This library provides functionality for managing 2FA entries
 * and handling encrypted data.
 */
class TwoFaLib {
  public readonly deviceIdentifier

  private saveFunction?: SaveFunction
  private privateKey?: PrivateKey
  private encryptedPrivateKey?: EncryptedPrivateKey
  private encryptedSymmetricKey?: EncryptedSymmetricKey
  private symmetricKey?: SymmetricKey
  private salt?: Salt

  private libraryLoader: LibraryLoader
  private syncManager: SyncManager
  private exportImportManager: ExportImportManager
  private vaultManager: VaultManager

  private wasChangedSinceLastSave: WasChangedSinceLastSave = {
    lockedRepresentation: true,
    encryptedPrivateKey: true,
    encryptedSymmetricKey: true,
    salt: true,
  }

  constructor(
    deviceIdentifier: string,
    cryptoLib: CryptoLib,
    saveFunction?: SaveFunction,
  ) {
    if (!deviceIdentifier) {
      throw new Error('Device identifier is required')
    }
    if (deviceIdentifier.length > 256) {
      throw new Error('Device identifier is too long, max 256 characters')
    }
    this.deviceIdentifier = deviceIdentifier
    this.saveFunction = saveFunction

    this.libraryLoader = new LibraryLoader(cryptoLib)
    this.syncManager = new SyncManager(this.libraryLoader, deviceIdentifier)
    this.vaultManager = new VaultManager(this)
    this.exportImportManager = new ExportImportManager(
      this.libraryLoader,
      this,
      this.vaultManager,
    )
  }

  private get cryptoLib() {
    return this.libraryLoader.getCryptoLib()
  }

  get vault() {
    return this.vaultManager
  }

  get exportImport() {
    return this.exportImportManager
  }

  get sync() {
    return this.syncManager
  }

  get inAddDeviceFlow(): boolean {
    return this.syncManager.inAddDeviceFlow
  }
  get webSocketConnected(): boolean {
    return this.syncManager.webSocketConnected
  }

  async save() {
    if (
      !this.encryptedPrivateKey ||
      !this.encryptedSymmetricKey ||
      !this.salt
    ) {
      throw new InitializationError('Initialisation not completed')
    }

    if (this.saveFunction) {
      const wasChangedSinceLastSaveCache = this.wasChangedSinceLastSave
      this.wasChangedSinceLastSave = {
        lockedRepresentation: false,
        encryptedPrivateKey: false,
        encryptedSymmetricKey: false,
        salt: false,
      }
      const lockedRepresentation = await this.getLockedRepresentation()
      return this.saveFunction(
        {
          lockedRepresentation,
          encryptedPrivateKey: this.encryptedPrivateKey,
          encryptedSymmetricKey: this.encryptedSymmetricKey,
          salt: this.salt,
        },
        wasChangedSinceLastSaveCache,
      )
    }
  }

  /**
   * Initialize the library with an encrypted private key and passphrase.
   * @param encryptedPrivateKey - The encrypted private key used for secure operations.
   * @param encryptedSymmetricKey - The encrypted symmetric key used for secure operations.
   * @param passphrase - The passphrase to decrypt the private key.
   * @returns A promise that resolves when initialization is complete.
   * @throws {InitializationError} If initialization fails due to technical issues.
   * @throws {AuthenticationError} If the provided passphrase is incorrect.
   */
  async init(
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    passphrase: Passphrase,
    serverUrl?: string,
  ): Promise<void> {
    const { privateKey, symmetricKey } = await this.cryptoLib.decryptKeys(
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
    }

    if (serverUrl) {
      if (!serverUrl.startsWith('ws://') && !serverUrl.startsWith('wss://')) {
        throw new Error('Invalid server URL, protocol must be ws or wss')
      }
      this.syncManager.initServerConnection(serverUrl)
    }
  }

  /**
   * Get a locked representation of the library's current state.
   * This can be used for secure storage or transmission of the library's data.
   * @returns A promise that resolves with a string representation of the locked state.
   */
  async getLockedRepresentation(): Promise<string> {
    if (!this.symmetricKey) {
      throw new InitializationError('PublicKey missing')
    }
    return await this.cryptoLib.encryptSymmetric(
      this.symmetricKey,
      JSON.stringify(this.vaultManager.__getEntriesForExport()),
    )
  }

  /**
   * Load the library state from a previously locked representation.
   * @param lockedRepresentation - The string representation of the locked state.
   * @returns A promise that resolves when loading is complete.
   * @throws {InitializationError} If loading fails due to invalid or corrupted data.
   */
  async loadFromLockedRepresentation(
    lockedRepresentation: string,
  ): Promise<void> {
    if (!this.symmetricKey) {
      throw new InitializationError('PrivateKey missing')
    }
    const newVault = JSON.parse(
      await this.cryptoLib.decryptSymmetric(
        this.symmetricKey,
        lockedRepresentation,
      ),
    ) as Vault
    this.vaultManager.replaceVault(newVault)
    this.wasChangedSinceLastSave.lockedRepresentation = true
  }

  /**
   * Validate the provided passphrase against the current library passphrase.
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

export const createTwoFaLib = async (
  deviceIdentifier: string,
  cryptolib: CryptoLib,
  passphrase: Passphrase,
  saveFunction?: SaveFunction,
  serverUrl?: string,
) => {
  const { publicKey, encryptedPrivateKey, encryptedSymmetricKey, salt } =
    await cryptolib.createKeys(passphrase)

  const twoFaLib = new TwoFaLib(deviceIdentifier, cryptolib, saveFunction)
  await twoFaLib.init(
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
    passphrase,
    serverUrl,
  )
  await twoFaLib.save()

  return {
    twoFaLib,
    publicKey,
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
  }
}

export default TwoFaLib
