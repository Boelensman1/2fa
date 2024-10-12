import { TypedEventTarget } from 'typescript-event-target'
import type { NonEmptyTuple } from 'type-fest'

import type CryptoLib from './interfaces/CryptoLib.mjs'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  Salt,
} from './interfaces/CryptoLib.mjs'
import type {
  SyncDevice,
  DeviceId,
  DeviceType,
} from './interfaces/SyncTypes.mjs'
import type {
  TwoFaLibEventMap,
  TwoFaLibEventMapEvents,
} from './interfaces/Events.mjs'

import TwoFaLibMediator from './TwoFaLibMediator.mjs'
import { TwoFaLibEvent } from './TwoFaLibEvent.mjs'
import { InitializationError } from './TwoFALibError.mjs'

import SyncManager from './subclasses/SyncManager.mjs'
import LibraryLoader from './subclasses/LibraryLoader.mjs'
import ExportImportManager from './subclasses/ExportImportManager.mjs'
import PersistentStorageManager from './subclasses/PersistentStorageManager.mjs'
import VaultDataManager from './subclasses/VaultDataManager.mjs'
import VaultOperationsManager from './subclasses/VaultOperationsManager.mjs'
import CommandManager from './subclasses/CommandManager.mjs'

/**
 * The Two-Factor Library, this is the main entry point.
 */
class TwoFaLib extends TypedEventTarget<TwoFaLibEventMapEvents> {
  public readonly deviceType: DeviceType
  public readonly deviceId?: DeviceId

  private mediator: TwoFaLibMediator

  /**
   * Constructs a new instance of TwoFaLib.
   * @param deviceType - A unique identifier for this device type (e.g. 2fa-cli).
   * @param cryptoLib - An instance of CryptoLib that is compatible with the environment.
   * @param passphraseExtraDict - Additional words to be used for passphrase strength evaluation.
   * @throws {InitializationError} If the device identifier is invalid.
   */
  constructor(
    deviceType: DeviceType,
    cryptoLib: CryptoLib,
    passphraseExtraDict: NonEmptyTuple<string>,
  ) {
    super()
    if (!deviceType) {
      throw new InitializationError('Device identifier is required')
    }
    if (deviceType.length > 256) {
      throw new InitializationError(
        'Device identifier is too long, max 256 characters',
      )
    }
    if (passphraseExtraDict?.length === 0) {
      throw new InitializationError(
        'Passphrase extra dictionary is required and must contain at least one element (eg phone)',
      )
    }
    this.deviceType = deviceType

    this.mediator = new TwoFaLibMediator()
    this.mediator.registerComponents([
      ['libraryLoader', new LibraryLoader(cryptoLib)],
      [
        'persistentStorageManager',
        new PersistentStorageManager(this.mediator, passphraseExtraDict),
      ],
      ['vaultDataManager', new VaultDataManager(this.mediator)],
      ['commandManager', new CommandManager(this.mediator)],
      ['vaultOperationsManager', new VaultOperationsManager(this.mediator)],
      [
        'exportImportManager',
        new ExportImportManager(this.mediator, passphraseExtraDict),
      ],
      ['dispatchLibEvent', this.dispatchLibEvent.bind(this)],
      ['log', this.log.bind(this)],
    ])
  }

  /**
   * Gives access to vault operations.
   * @returns The vault manager instance which can be used to perform operations on the vault.
   */
  get vault() {
    return this.mediator.getComponent('vaultOperationsManager')
  }

  /**
   * Gives access to export/import operations.
   * @returns The export/import manager instance which can be used to export and import vaults.
   */
  get exportImport() {
    return this.mediator.getComponent('exportImportManager')
  }

  /**
   * Gives access to sync operations.
   * @returns The sync manager instance which can be used to sync the vault with a server or null if none was initialized.
   */
  get sync() {
    if (!this.mediator.componentIsInitialised('syncManager')) {
      return null
    }
    return this.mediator.getComponent('syncManager')
  }

  /**
   * Gives access to persistent storage operations.
   * @returns The persistent storage manager instance which can be used to store data.
   */
  get persistentStorage() {
    return this.mediator.getComponent('persistentStorageManager')
  }

  /**
   * Dispatches a library event.
   * @param eventType - The type of the event to dispatch, uses the TwoFaLibEvent enum.
   * @param data - Optional data to include with the event.
   */
  private dispatchLibEvent<K extends keyof TwoFaLibEventMap>(
    eventType: K,
    data?: TwoFaLibEventMap[K],
  ) {
    this.dispatchTypedEvent(
      eventType,
      new CustomEvent(eventType, { detail: data }) as TwoFaLibEventMapEvents[K],
    )
  }

  /**
   * Log a message
   * @param severity - The severity of the message, either 'info' or 'warning'.
   * @param message - The message to log.
   */
  private log(severity: 'info' | 'warning', message: string) {
    this.dispatchLibEvent(TwoFaLibEvent.Log, { severity, message })
  }

  /**
   * Initialize the library, must be called before any other method. If no
   * encryptedPrivateKey and passphrase have been created yet, use the createNewTwoFaLibVault
   * method. If a serverUrl is provided, the library will use it for its sync operations.
   * @param encryptedPrivateKey - The encrypted private key used for cryptographic operations.
   * @param encryptedSymmetricKey - The encrypted symmetric key used for cryptographic operations.
   * @param salt - The salt used for key derivation from the passphrase.
   * @param passphrase - The passphrase to decrypt the private key.
   * @param deviceId - A unique identifier for this device.
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
    deviceId: DeviceId,
    serverUrl?: string,
    syncDevices?: SyncDevice[],
  ): Promise<void> {
    // @ts-expect-error deviceId is readonly but we can't set it in the constructor
    this.deviceId = deviceId

    const { publicKey, privateKey } = await this.persistentStorage.init(
      deviceId,
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
          this.deviceType,
          publicKey,
          privateKey,
          serverUrl,
          deviceId,
          syncDevices,
        ),
      )
    }
  }
}
export default TwoFaLib
