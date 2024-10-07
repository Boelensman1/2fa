import { v4 as genUuidV4 } from 'uuid'
import { TypedEventTarget } from 'typescript-event-target'
import type CryptoLib from './interfaces/CryptoLib.mjs'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  Salt,
} from './interfaces/CryptoLib.mjs'

import type { SyncDevice, UserId } from './interfaces/SyncTypes.mjs'
import type {
  TwoFaLibEventMap,
  TwoFaLibEventMapEvents,
} from './interfaces/Events.mjs'

import { InitializationError } from './TwoFALibError.mjs'

import SyncManager from './subclasses/SyncManager.mjs'
import LibraryLoader from './subclasses/LibraryLoader.mjs'
import ExportImportManager from './subclasses/ExportImportManager.mjs'
import PersistentStorageManager from './subclasses/PersistentStorageManager.mjs'
import InternalVaultManager from './subclasses/InternalVaultManager.mjs'
import ExternalVaultManager from './subclasses/ExternalVaultManager.mjs'
import CommandManager from './subclasses/CommandManager.mjs'
import TwoFaLibMediator from './TwoFaLibMediator.mjs'

/**
 * Two-Factor Authentication Library
 * This library provides functionality for managing 2FA entries
 * and handling encrypted data.
 */
class TwoFaLib extends TypedEventTarget<TwoFaLibEventMapEvents> {
  public readonly deviceIdentifier
  public readonly userId?: UserId

  private mediator: TwoFaLibMediator

  constructor(deviceIdentifier: string, cryptoLib: CryptoLib) {
    super()
    if (!deviceIdentifier) {
      throw new InitializationError('Device identifier is required')
    }
    if (deviceIdentifier.length > 256) {
      throw new InitializationError(
        'Device identifier is too long, max 256 characters',
      )
    }
    this.deviceIdentifier = deviceIdentifier

    this.mediator = new TwoFaLibMediator()
    this.mediator.registerComponents([
      ['libraryLoader', new LibraryLoader(cryptoLib)],
      ['persistentStorageManager', new PersistentStorageManager(this.mediator)],
      ['internalVaultManager', new InternalVaultManager(this.mediator)],
      ['commandManager', new CommandManager(this.mediator)],
      ['externalVaultManager', new ExternalVaultManager(this.mediator)],
      ['exportImportManager', new ExportImportManager(this.mediator)],
      ['dispatchLibEvent', this.dispatchLibEvent.bind(this)],
    ])
  }

  get vault() {
    return this.mediator.getExternalVaultManager()
  }

  get exportImport() {
    return this.mediator.getExportImportManager()
  }

  get sync() {
    return this.mediator.getSyncManager()
  }

  get persistentStorage() {
    return this.mediator.getPersistentStorageManager()
  }

  private dispatchLibEvent<K extends keyof TwoFaLibEventMap>(
    eventName: K,
    data?: TwoFaLibEventMap[K],
  ) {
    this.dispatchTypedEvent(
      eventName,
      new CustomEvent(eventName, { detail: data }) as TwoFaLibEventMapEvents[K],
    )
  }

  /**
   * Initialize the library with an encrypted private key and passphrase.
   * @param encryptedPrivateKey - The encrypted private key used for secure operations.
   * @param encryptedSymmetricKey - The encrypted symmetric key used for secure operations.
   * @param salt - The salt used for key derivation.
   * @param passphrase - The passphrase to decrypt the private key.
   * @param userId - The user ID used for identification.
   * @param serverUrl - The server URL for syncing.
   * @param syncDevices - The devices to sync with.
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

    const getPersistentStorageManager =
      this.mediator.getPersistentStorageManager()
    const { publicKey, privateKey } = await getPersistentStorageManager.init(
      userId,
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      passphrase,
    )

    if (serverUrl) {
      this.mediator.registerComponent(
        'syncManager',
        new SyncManager(
          this.mediator,
          this.deviceIdentifier,
          publicKey,
          privateKey,
          serverUrl,
          userId,
          syncDevices,
        ),
      )
    }
  }
}

export const createNewTwoFaLibVault = async (
  deviceIdentifier: string,
  cryptolib: CryptoLib,
  passphrase: Passphrase,
  serverUrl?: string,
) => {
  const { publicKey, encryptedPrivateKey, encryptedSymmetricKey, salt } =
    await cryptolib.createKeys(passphrase)

  const userId = genUuidV4() as UserId
  const twoFaLib = new TwoFaLib(deviceIdentifier, cryptolib)
  await twoFaLib.init(
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
    passphrase,
    userId,
    serverUrl,
  )

  return {
    twoFaLib,
    publicKey,
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
  }
}

export default TwoFaLib
