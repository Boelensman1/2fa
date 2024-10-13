import type TwoFaLib from './TwoFaLib.mjs'
import type LibraryLoader from './subclasses/LibraryLoader.mjs'
import type ExportImportManager from './subclasses/ExportImportManager.mjs'
import type PersistentStorageManager from './subclasses/PersistentStorageManager.mjs'
import type VaultDataManager from './subclasses/VaultDataManager.mjs'
import type ExternalVaultManager from './subclasses/VaultOperationsManager.mjs'
import type CommandManager from './subclasses/CommandManager.mjs'
import type SyncManager from './subclasses/SyncManager.mjs'
import { InitializationError } from './TwoFALibError.mjs'

/**
 * Mediator class for managing and accessing various components of the TwoFaLib.
 */
class TwoFaLibMediator {
  private components: {
    libraryLoader?: LibraryLoader
    persistentStorageManager?: PersistentStorageManager
    vaultDataManager?: VaultDataManager
    commandManager?: CommandManager
    vaultOperationsManager?: ExternalVaultManager
    exportImportManager?: ExportImportManager
    syncManager?: SyncManager
    dispatchLibEvent?: (typeof TwoFaLib.prototype)['dispatchLibEvent']
    log?: (typeof TwoFaLib.prototype)['log']
  } = {}

  /**
   * Registers a single component with the mediator.
   * @param key - The key representing the component type.
   * @param component - The component instance to register.
   * @throws {InitializationError} If the component is already registered.
   */
  registerComponent<T extends keyof typeof this.components>(
    key: T,
    component: NonNullable<(typeof this.components)[T]>,
  ) {
    if (this.components[key]) {
      throw new InitializationError(`Component ${key} already registered`)
    }
    this.components[key] = component
  }

  /**
   * Registers multiple components with the mediator.
   * @param componentsArray - An array of key-component pairs to register.
   */
  registerComponents<T extends keyof typeof this.components>(
    componentsArray: [T, NonNullable<(typeof this.components)[T]>][],
  ) {
    for (const [key, component] of componentsArray) {
      this.registerComponent(key, component)
    }
  }

  /**
   * Retrieves a component by its key.
   * @param key - The key representing the component type.
   * @returns The component instance.
   * @throws {InitializationError} If the component is not initialized.
   */
  getComponent<T extends keyof typeof this.components>(
    key: T,
  ): NonNullable<(typeof this.components)[T]> {
    if (!this.components[key]) {
      throw new InitializationError(`${key} is not initialized`)
    }
    return this.components[key]
  }

  /**
   * Checks if a component is initialized.
   * @param key - The key representing the component type.
   * @returns True if the component is initialized, false otherwise.
   */
  componentIsInitialised<T extends keyof typeof this.components>(
    key: T,
  ): boolean {
    return Boolean(this.components[key])
  }
}

export default TwoFaLibMediator
