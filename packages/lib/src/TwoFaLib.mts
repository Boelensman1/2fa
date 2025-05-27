import { TypedEventTarget } from 'typescript-event-target'

import type CryptoLib from './interfaces/CryptoLib.mjs'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
} from './interfaces/CryptoLib.mjs'
import type {
  DeviceFriendlyName,
  DeviceId,
  DeviceType,
} from './interfaces/SyncTypes.mjs'
import type {
  TwoFaLibEventMap,
  TwoFaLibEventMapEvents,
} from './interfaces/Events.mjs'
import type { PassphraseExtraDict } from './interfaces/PassphraseExtraDict.js'
import type {
  Vault,
  VaultSyncState,
  VaultSyncStateWithServerUrl,
} from './interfaces/Vault.mjs'

import TwoFaLibMediator from './TwoFaLibMediator.mjs'
import { TwoFaLibEvent } from './TwoFaLibEvent.mjs'
import { InitializationError, SyncError } from './TwoFALibError.mjs'

import SyncManager, { ConnectionStatus } from './subclasses/SyncManager.mjs'
import LibraryLoader from './subclasses/LibraryLoader.mjs'
import ExportImportManager from './subclasses/ExportImportManager.mjs'
import PersistentStorageManager from './subclasses/PersistentStorageManager.mjs'
import VaultDataManager from './subclasses/VaultDataManager.mjs'
import VaultOperationsManager from './subclasses/VaultOperationsManager.mjs'
import CommandManager from './subclasses/CommandManager.mjs'
import SaveFunction from './interfaces/SaveFunction.mjs'
import StorageOperationsManager from './subclasses/StorageOperationsManager.mjs'

/**
 * The Two-Factor Library, this is the main entry point.
 */
class TwoFaLib extends TypedEventTarget<TwoFaLibEventMapEvents> {
  // TOOD: load this from package.json
  public static readonly version = '0.0.1'

  public readonly deviceId: DeviceId
  public readonly deviceType: DeviceType
  public deviceFriendlyName: DeviceFriendlyName = '' as DeviceFriendlyName

  private mediator: TwoFaLibMediator

  private readonly publicKey: PublicKey
  private readonly privateKey: PrivateKey

  public readonly ready: Promise<unknown>

  /**
   * Constructs a new instance of TwoFaLib. If a serverUrl is provided, the library will use it for its sync operations.
   * @param deviceType - The identifier for this device type (e.g. 2fa-cli).
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
   * @param saveFunction - The function to save the data.
   * @param syncState - The state of the sync, includes the serverUrl
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
    saveFunction?: SaveFunction,
    syncState?: VaultSyncState,
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
    this.publicKey = publicKey
    this.privateKey = privateKey

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
          saveFunction,
        ),
      ],
      ['vaultDataManager', new VaultDataManager(this.mediator)],
      ['commandManager', new CommandManager(this.mediator)],
      ['vaultOperationsManager', new VaultOperationsManager(this.mediator)],
      ['storageOperationsManager', new StorageOperationsManager(this.mediator)],
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

    if (syncState?.serverUrl) {
      // Initiate the syncManager
      this.mediator.registerComponent(
        'syncManager',
        new SyncManager(
          this.mediator,
          this.publicKey,
          this.privateKey,
          syncState as VaultSyncStateWithServerUrl,
          this.deviceId,
        ),
      )
    } else {
      // If no syncmanager we're ready now, otherwise the syncmanager is responsible for emitting the ready event
      // We do this with a delay of 1, so that there is time to add event listeners
      setTimeout(() => this.dispatchLibEvent(TwoFaLibEvent.Ready), 1)
    }

    // populate the ready property
    let setReady: () => void
    this.ready = new Promise<void>((resolve) => {
      setReady = resolve
    })

    const handleReadyEvent = () => {
      setReady()
      this.removeEventListener(TwoFaLibEvent.Ready, handleReadyEvent)
    }

    this.addEventListener(TwoFaLibEvent.Ready, handleReadyEvent)
  }

  /**
   * @returns The persistent storage manager instance which can be used to store data.
   */
  private get persistentStorageManager() {
    return this.mediator.getComponent('persistentStorageManager')
  }

  /**
   * Gives access to vault operations.
   * @returns The vault operations manager instance which can be used to perform operations on the vault.
   */
  get vault() {
    return this.mediator.getComponent('vaultOperationsManager')
  }

  /**
   * Gives access to storage operations.
   * @returns The storage operations manager instance which can be used to perform operations on the vault.
   */
  get storage() {
    return this.mediator.getComponent('storageOperationsManager')
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
   * Sets a server url, this will allow syncing with the server.
   * @param serverUrl - The server url.
   * @param force - Force setting the sync server url, even if no connection can be made
   */
  async setSyncServerUrl(serverUrl: string, force = false) {
    if (this.sync) {
      // close connection so no data is send to the old syncServer
      this.sync.closeServerConnection()
    }

    const newSyncState: VaultSyncStateWithServerUrl = {
      serverUrl,
      devices: [],
      commandSendQueue: [],
    }
    const newSyncManager = new SyncManager(
      this.mediator,
      this.publicKey,
      this.privateKey,
      newSyncState,
      this.deviceId,
    )

    const success = await new Promise((resolve) => {
      this.addEventListener(
        TwoFaLibEvent.ConnectionToSyncServerStatusChanged,
        (event) => {
          if (event.detail.newStatus === ConnectionStatus.CONNECTED) {
            resolve(true)
          }
          if (event.detail.newStatus === ConnectionStatus.FAILED) {
            resolve(false)
          }
        },
      )
    })
    if (!success) {
      if (force) {
        this.log(
          'warning',
          `Failed to connect to server at ${serverUrl}, force setting`,
        )
      } else {
        if (this.sync) {
          // re-establish old connection
          this.sync.initServerConnection()
        }

        newSyncManager.closeServerConnection()
        throw new SyncError(
          `Failed to connect to server at ${serverUrl}, not setting`,
        )
      }
    }

    // connection succeeded (or force=true)
    // switch to the new syncManager
    this.mediator.unRegisterComponent('syncManager')
    this.mediator.registerComponent('syncManager', newSyncManager)

    // save
    await this.persistentStorageManager.save()
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
