import { TypedEventTarget } from 'typescript-event-target'

import type { PlatformProviders } from './interfaces/PlatformProviders.mjs'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
} from './interfaces/CryptoLib.mjs'
import type { DeviceFriendlyName, DeviceType } from './interfaces/SyncTypes.mjs'
import type {
  FavaLibEventMap,
  FavaLibEventMapEvents,
} from './interfaces/Events.mjs'
import type { PasswordExtraDict } from './interfaces/PasswordExtraDict.js'
import type {
  Vault,
  VaultSyncState,
  VaultSyncStateWithServerUrl,
} from './interfaces/Vault.mjs'
import type { SaveFunction } from './interfaces/SaveFunction.mjs'
import type { FavaMeta } from './interfaces/FavaMeta.mjs'
import type { ChangeDeviceInfoData } from './Command/commands/ChangeDeviceInfoCommand.mjs'

import FavaLibMediator from './FavaLibMediator.mjs'
import { FavaLibEvent } from './FavaLibEvent.mjs'
import {
  InitializationError,
  SyncError,
  FavaLibError,
} from './FavaLibError.mjs'

import SyncManager, { ConnectionStatus } from './subclasses/SyncManager.mjs'
import LibraryLoader from './subclasses/LibraryLoader.mjs'
import ExportImportManager from './subclasses/ExportImportManager.mjs'
import PersistentStorageManager from './subclasses/PersistentStorageManager.mjs'
import VaultDataManager from './subclasses/VaultDataManager.mjs'
import VaultOperationsManager from './subclasses/VaultOperationsManager.mjs'
import CommandManager from './subclasses/CommandManager.mjs'
import StorageOperationsManager from './subclasses/StorageOperationsManager.mjs'
import ChangeDeviceInfoCommand from './Command/commands/ChangeDeviceInfoCommand.mjs'

/**
 * The Two-Factor Library, this is the main entry point.
 */
class FavaLib extends TypedEventTarget<FavaLibEventMapEvents> {
  // TOOD: load this from package.json
  public static readonly version = '0.0.1'

  private readonly favaMeta: FavaMeta
  public readonly deviceType: DeviceType
  public deviceFriendlyName?: DeviceFriendlyName

  private mediator: FavaLibMediator

  private readonly publicKey: PublicKey
  private readonly privateKey: PrivateKey

  public readonly ready: Promise<unknown>

  /**
   * @returns The meta info for this device.
   */
  public get meta() {
    return {
      deviceId: this.favaMeta.deviceId,
      deviceFriendlyName: this.deviceFriendlyName ?? '',
      deviceType: this.deviceType,
    }
  }

  /**
   * Constructs a new instance of FavaLib. If a serverUrl is provided, the library will use it for its sync operations.
   * @param deviceType - The identifier for this device type (e.g. 2fa-cli).
   * @param platformProviders - The platform-specific providers containing CryptoLib and other providers.
   * @param passwordExtraDict - Additional words to be used for password strength evaluation.
   * @param privateKey - The private key used for cryptographic operations.
   * @param symmetricKey - The symmetric key used for cryptographic operations.
   * @param encryptedPrivateKey - The encrypted private key
   * @param encryptedSymmetricKey - The encrypted symmetric key
   * @param salt - The salt used for key derivation.
   * @param publicKey - The public key of the device.
   * @param favaMeta - Meta info about this device containing at least a unique identifier for this device.
   * @param vault - The vault data (entries)
   * @param saveFunction - The function to save the data.
   * @param syncState - The state of the sync, includes the serverUrl
   * @returns A promise that resolves when initialization is complete.
   * @throws {InitializationError} If some parameter has an invalid value
   * @throws {AuthenticationError} If the provided password is incorrect.
   */
  constructor(
    deviceType: DeviceType,
    platformProviders: PlatformProviders,
    passwordExtraDict: PasswordExtraDict,
    privateKey: PrivateKey,
    symmetricKey: SymmetricKey,
    encryptedPrivateKey: EncryptedPrivateKey,
    encryptedSymmetricKey: EncryptedSymmetricKey,
    salt: Salt,
    publicKey: PublicKey,
    favaMeta: FavaMeta,
    vault?: Vault,
    saveFunction?: SaveFunction,
    syncState?: VaultSyncState,
  ) {
    super()
    if (!deviceType) {
      throw new InitializationError('Device type is required')
    }
    if (!favaMeta.deviceId) {
      throw new InitializationError('Device id is required')
    }
    if (deviceType.length > 256) {
      throw new InitializationError(
        'Device type is too long, max 256 characters',
      )
    }
    if (
      favaMeta.deviceFriendlyName &&
      favaMeta.deviceFriendlyName.length > 256
    ) {
      throw new InitializationError(
        'Device friendly name is too long, max 256 characters',
      )
    }
    if (passwordExtraDict?.length === 0) {
      throw new InitializationError(
        'Password extra dictionary is required and must contain at least one element (eg phone)',
      )
    }
    this.favaMeta = favaMeta
    this.deviceType = deviceType
    this.publicKey = publicKey
    this.privateKey = privateKey

    this.mediator = new FavaLibMediator()
    this.mediator.registerComponents([
      ['libraryLoader', new LibraryLoader(platformProviders)],
      [
        'persistentStorageManager',
        new PersistentStorageManager(
          this.mediator,
          passwordExtraDict,
          favaMeta,
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
        new ExportImportManager(this.mediator, passwordExtraDict),
      ],
      ['dispatchLibEvent', this.dispatchLibEvent.bind(this)],
      ['log', this.log.bind(this)],
      ['lib', this],
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
          this.favaMeta,
          syncState as VaultSyncStateWithServerUrl,
          this.deviceType,
        ),
      )
    } else {
      // If no syncmanager we're ready now, otherwise the syncmanager is responsible for emitting the ready event
      // We do this with a delay of 1, so that there is time to add event listeners
      setTimeout(() => this.dispatchLibEvent(FavaLibEvent.Ready), 1)
    }

    // populate the ready property
    let setReady: () => void
    this.ready = new Promise<void>((resolve) => {
      setReady = resolve
    })

    const handleReadyEvent = () => {
      setReady()
      this.removeEventListener(FavaLibEvent.Ready, handleReadyEvent)
    }

    this.addEventListener(FavaLibEvent.Ready, handleReadyEvent)
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
    const oldSyncManager = this.sync
    if (oldSyncManager) {
      // close connection so no data is send to the old syncServer
      oldSyncManager.closeServerConnection()
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
      this.favaMeta,
      newSyncState,
      this.deviceType,
    )

    // Temporarily register the new sync manager so its events can be heard
    this.mediator.unRegisterComponent('syncManager')
    this.mediator.registerComponent('syncManager', newSyncManager)

    const success = await new Promise((resolve) => {
      this.addEventListener(
        FavaLibEvent.ConnectionToSyncServerStatusChanged,
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
        // Close the new sync manager and restore the old one
        newSyncManager.closeServerConnection()
        this.mediator.unRegisterComponent('syncManager')

        if (oldSyncManager) {
          // re-establish old connection
          this.mediator.registerComponent('syncManager', oldSyncManager)
          oldSyncManager.initServerConnection()
        }

        throw new SyncError(
          `Failed to connect to server at ${serverUrl}, not setting`,
        )
      }
    }

    // connection succeeded (or force=true) - new sync manager is already registered
    // save
    await this.persistentStorageManager.save()
  }

  /**
   * Set a friendly name for this vault (used in syncing)
   * @param deviceFriendlyName Human readable name for the device
   */
  public async setDeviceFriendlyName(deviceFriendlyName: DeviceFriendlyName) {
    const data: ChangeDeviceInfoData = {
      deviceId: this.favaMeta.deviceId,
      newDeviceInfo: { deviceType: this.deviceType, deviceFriendlyName },
    }
    const command = ChangeDeviceInfoCommand.create(data)

    if (!command.validate(this.mediator)) {
      throw new FavaLibError(
        'Device friendly name has invalid length, max 256 characters',
      )
    }

    await this.mediator.getComponent('commandManager').execute(command)
  }

  /**
   * Dispatches a library event.
   * @param eventType - The type of the event to dispatch, uses the FavaLibEvent enum.
   * @param data - Optional data to include with the event.
   */
  private dispatchLibEvent<K extends keyof FavaLibEventMap>(
    eventType: K,
    data?: FavaLibEventMap[K],
  ) {
    this.dispatchTypedEvent(
      eventType,
      new CustomEvent(eventType, { detail: data }) as FavaLibEventMapEvents[K],
    )
  }

  /**
   * Log a message
   * @param severity - The severity of the message, either 'info' or 'warning'.
   * @param message - The message to log.
   */
  private log(severity: 'info' | 'warning', message: string) {
    this.dispatchLibEvent(FavaLibEvent.Log, { severity, message })
  }
}
export default FavaLib
