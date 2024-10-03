import type CryptoLib from './interfaces/CryptoLib.js'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  Salt,
} from './interfaces/CryptoLib.js'

import { SaveFunction } from './interfaces/SaveFunction.js'

import SyncManager from './subclasses/SyncManager.mjs'
import LibraryLoader from './subclasses/LibraryLoader.mjs'
import VaultManager from './subclasses/VaultManager.mjs'
import ExportImportManager from './subclasses/ExportImportManager.mjs'
import PersistentStorageManager from './subclasses/PersistentStorageManager.mjs'
/**
 * Two-Factor Authentication Library
 * This library provides functionality for managing 2FA entries
 * and handling encrypted data.
 */
class TwoFaLib {
  public readonly deviceIdentifier

  private libraryLoader: LibraryLoader
  private exportImportManager: ExportImportManager
  private vaultManager: VaultManager
  private persistentStorageManager: PersistentStorageManager
  private syncManager?: SyncManager

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

    this.libraryLoader = new LibraryLoader(cryptoLib)
    this.persistentStorageManager = new PersistentStorageManager(
      this.libraryLoader,
      saveFunction,
    )
    this.vaultManager = new VaultManager(this.persistentStorageManager)
    this.exportImportManager = new ExportImportManager(
      this.libraryLoader,
      this.persistentStorageManager,
      this.vaultManager,
    )
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

  get persistentStorage() {
    return this.persistentStorageManager
  }

  get inAddDeviceFlow(): boolean {
    return this.syncManager?.inAddDeviceFlow ?? false
  }
  get webSocketConnected(): boolean {
    return this.syncManager?.webSocketConnected ?? false
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
    const { publicKey } = await this.persistentStorageManager.init(
      this.vaultManager, // passed here to avoid circular dependency
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
    )

    if (serverUrl) {
      this.syncManager = new SyncManager(
        this.libraryLoader,
        this.vaultManager,
        this.exportImportManager,
        this.deviceIdentifier,
        publicKey,
        serverUrl,
      )
    }
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
  await twoFaLib.persistentStorage.save()

  return {
    twoFaLib,
    publicKey,
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
  }
}

export default TwoFaLib
