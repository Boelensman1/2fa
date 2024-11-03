import { TypedEventTarget } from 'typescript-event-target'

import type CryptoLib from './interfaces/CryptoLib.mjs'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  Passphrase,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
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
import type { PassphraseExtraDict } from './interfaces/PassphraseExtraDict.js'
import type { Vault } from './interfaces/Vault.mjs'

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
  // TOOD: load this from package.json
  public static readonly version = '0.0.1'

  public readonly deviceId?: DeviceId
  public readonly deviceType: DeviceType

  private mediator: TwoFaLibMediator

  /**
   * Constructs a new instance of TwoFaLib. If a serverUrl is provided, the library will use it for its sync operations.
   * @param deviceType - A unique identifier for this device type (e.g. 2fa-cli).
   * @param cryptoLib - An instance of CryptoLib that is compatible with the environment.
   * @param passphraseExtraDict - Additional words to be used for passphrase strength evaluation.
   * @param privateKey - The private key used for cryptographic operations.
   * @param symmetricKey - The symmetric key used for cryptographic operations.
   * @param encryptedPrivateKey - The encrypted private key
   * @param encryptedSymmetricKey - The encrypted symmetric key
   * @param salt - The salt used for key derivation.
   * @param publicKey - The public key of the device.
   * @param deviceId - A unique identifier for this device.
   * @param vault - The vault data (entries)
   * @param serverUrl - The server URL for syncing.
   * @param syncDevices - The devices to sync with.
   * @returns A promise that resolves when initialization is complete.
   * @throws {InitializationError} If some parameter has an invalid value
   * @throws {AuthenticationError} If the provided passphrase is incorrect.
   */
  constructor(
    deviceType: DeviceType,
    cryptoLib: CryptoLib,
    passphraseExtraDict: PassphraseExtraDict,
    privateKey: PrivateKey,
    symmetricKey: SymmetricKey,
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    publicKey: PublicKey,
    deviceId: DeviceId,
    vault?: Vault,
    serverUrl?: string,
    syncDevices?: SyncDevice[],
  ) {
    super()
    if (!deviceType) {
      throw new InitializationError('Device type is required')
    }
    if (!deviceId) {
      throw new InitializationError('Device id is required')
    }
    if (deviceType.length > 256) {
      throw new InitializationError(
        'Device type is too long, max 256 characters',
      )
    }
    if (passphraseExtraDict?.length === 0) {
      throw new InitializationError(
        'Passphrase extra dictionary is required and must contain at least one element (eg phone)',
      )
    }
    this.deviceType = deviceType
    this.deviceId = deviceId

    this.mediator = new TwoFaLibMediator()
    this.mediator.registerComponents([
      ['libraryLoader', new LibraryLoader(cryptoLib)],
      [
        'persistentStorageManager',
        new PersistentStorageManager(
          this.mediator,
          passphraseExtraDict,
          deviceId,
          privateKey,
          symmetricKey,
          encryptedPrivateKey,
          encryptedSymmetricKey,
          salt,
        ),
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

    if (vault) {
      this.mediator.getComponent('vaultDataManager').replaceVault(vault)
    }

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
    } else {
      // If no syncmanager we're ready now, otherwise the syncmanager is responsible for emitting the ready event
      // We do this with a delay of 1, so that there is time to add event listeners
      setTimeout(() => this.dispatchLibEvent(TwoFaLibEvent.Ready), 1)
    }
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
   * @returns The persistent storage manager instance which can be used to store data.
   */
  private get persistentStorage() {
    return this.mediator.getComponent('persistentStorageManager')
  }

  /**
   * Forces a save of the persistent storage.
   */
  async forceSave() {
    await this.persistentStorage.save()
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
    return this.persistentStorage.changePassphrase(oldPassphrase, newPassphrase)
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
}
export default TwoFaLib
