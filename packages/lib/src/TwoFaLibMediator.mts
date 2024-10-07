import type TwoFaLib from './TwoFaLib.mjs'
import type LibraryLoader from './subclasses/LibraryLoader.mjs'
import type ExportImportManager from './subclasses/ExportImportManager.mjs'
import type PersistentStorageManager from './subclasses/PersistentStorageManager.mjs'
import type InternalVaultManager from './subclasses/InternalVaultManager.mjs'
import type ExternalVaultManager from './subclasses/ExternalVaultManager.mjs'
import type CommandManager from './subclasses/CommandManager.mjs'
import type SyncManager from './subclasses/SyncManager.mjs'
import { InitializationError } from './TwoFALibError.mjs'

class TwoFaLibMediator {
  private components: {
    libraryLoader?: LibraryLoader
    persistentStorageManager?: PersistentStorageManager
    internalVaultManager?: InternalVaultManager
    commandManager?: CommandManager
    externalVaultManager?: ExternalVaultManager
    exportImportManager?: ExportImportManager
    dispatchLibEvent?: (typeof TwoFaLib.prototype)['dispatchLibEvent']
    syncManager?: SyncManager
  } = {}

  registerComponent<T extends keyof typeof this.components>(
    key: T,
    component: (typeof this.components)[T],
  ) {
    if (this.components[key]) {
      throw new InitializationError(`Component ${key} already registered`)
    }
    this.components[key] = component
  }

  registerComponents<T extends keyof typeof this.components>(
    componentsArray: [T, NonNullable<(typeof this.components)[T]>][],
  ) {
    for (const [key, component] of componentsArray) {
      this.registerComponent(key, component)
    }
  }

  getLibraryLoader() {
    if (!this.components.libraryLoader) {
      throw new InitializationError('LibraryLoader not initialized')
    }
    return this.components.libraryLoader
  }

  getPersistentStorageManager() {
    if (!this.components.persistentStorageManager) {
      throw new InitializationError('PersistentStorageManager not initialized')
    }
    return this.components.persistentStorageManager
  }

  getInternalVaultManager() {
    if (!this.components.internalVaultManager) {
      throw new InitializationError('InternalVaultManager not initialized')
    }
    return this.components.internalVaultManager
  }

  getCommandManager() {
    if (!this.components.commandManager) {
      throw new InitializationError('CommandManager not initialized')
    }
    return this.components.commandManager
  }

  getExternalVaultManager() {
    if (!this.components.externalVaultManager) {
      throw new InitializationError('ExternalVaultManager not initialized')
    }
    return this.components.externalVaultManager
  }

  getExportImportManager() {
    if (!this.components.exportImportManager) {
      throw new InitializationError('ExportImportManager not initialized')
    }
    return this.components.exportImportManager
  }

  getSyncManager() {
    return this.components.syncManager
  }

  getDispatchLibEvent() {
    if (!this.components.dispatchLibEvent) {
      throw new InitializationError('DispatchLibEvent not initialized')
    }
    return this.components.dispatchLibEvent
  }
}

export default TwoFaLibMediator
