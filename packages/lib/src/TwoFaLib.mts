import { v4 as genUuidV4 } from 'uuid'
import type CryptoLib from './interfaces/CryptoLib.mjs'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  Salt,
} from './interfaces/CryptoLib.mjs'

import type { SaveFunction } from './interfaces/SaveFunction.mjs'
import type { SyncDevice, UserId } from './interfaces/SyncTypes.mjs'

import { InitializationError } from './TwoFALibError.mjs'

import SyncManager from './subclasses/SyncManager.mjs'
import LibraryLoader from './subclasses/LibraryLoader.mjs'
import ExportImportManager from './subclasses/ExportImportManager.mjs'
import PersistentStorageManager from './subclasses/PersistentStorageManager.mjs'
import InternalVaultManager from './subclasses/InternalVaultManager.mjs'
import ExternalVaultManager from './subclasses/ExternalVaultManager.mjs'
import CommandManager from './subclasses/CommandManager.mjs'
/**
 * Two-Factor Authentication Library
 * This library provides functionality for managing 2FA entries
 * and handling encrypted data.
 */
class TwoFaLib {
  public readonly deviceIdentifier
  public readonly userId?: UserId

  private libraryLoader: LibraryLoader
  private exportImportManager: ExportImportManager
  private internalVaultManager: InternalVaultManager
  private externalVaultManager: ExternalVaultManager
  private persistentStorageManager: PersistentStorageManager
  private commandManager: CommandManager
  private syncManager?: SyncManager

  constructor(
    deviceIdentifier: string,
    cryptoLib: CryptoLib,
    saveFunction?: SaveFunction,
  ) {
    if (!deviceIdentifier) {
      throw new InitializationError('Device identifier is required')
    }
    if (deviceIdentifier.length > 256) {
      throw new InitializationError(
        'Device identifier is too long, max 256 characters',
      )
    }
    this.deviceIdentifier = deviceIdentifier

    this.libraryLoader = new LibraryLoader(cryptoLib)
    this.persistentStorageManager = new PersistentStorageManager(
      this.libraryLoader,
      this,
      saveFunction,
    )
    this.internalVaultManager = new InternalVaultManager(
      this.persistentStorageManager,
    )
    this.commandManager = new CommandManager(this.internalVaultManager)
    this.externalVaultManager = new ExternalVaultManager(
      this.internalVaultManager,
      this.commandManager,
    )
    this.exportImportManager = new ExportImportManager(
      this.libraryLoader,
      this.persistentStorageManager,
      this.externalVaultManager,
      this.internalVaultManager,
    )
  }

  get vault() {
    return this.externalVaultManager
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
    userId: UserId,
    serverUrl?: string,
    syncDevices?: SyncDevice[],
  ): Promise<void> {
    // @ts-expect-error userId is readonly but we can't set it in the constructor
    this.userId = userId

    const { publicKey, privateKey } = await this.persistentStorageManager.init(
      userId,
      this.internalVaultManager, // passed here to avoid circular dependency
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
    )

    if (serverUrl) {
      this.syncManager = new SyncManager(
        this.libraryLoader,
        this.commandManager,
        this.persistentStorageManager,
        this.deviceIdentifier,
        publicKey,
        privateKey,
        serverUrl,
        userId,
        syncDevices,
      )
      this.commandManager.setSyncManager(this.syncManager)
      this.persistentStorageManager.setSyncManager(this.syncManager)
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

  const userId = genUuidV4() as UserId
  const twoFaLib = new TwoFaLib(deviceIdentifier, cryptolib, saveFunction)
  await twoFaLib.init(
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
    passphrase,
    userId,
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
