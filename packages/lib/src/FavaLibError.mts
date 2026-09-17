/* eslint-disable no-restricted-globals */
/**
 * Custom error class for the libs errors.
 */
export class FavaLibError extends Error {
  /**
   * Creates a new Error.
   * @param message - The error message.
   */
  constructor(message: string) {
    super(message)
    this.name = 'FavaLibError'
  }
}

/**
 * Error thrown during lib initialization failures.
 */
export class InitializationError extends FavaLibError {}

/**
 * Error thrown during authentication, e.g. wrong password for locked vault.
 */
export class AuthenticationError extends FavaLibError {}

/**
 * Error thrown when an entry is requested but not found.
 */
export class EntryNotFoundError extends FavaLibError {}

/**
 * Error thrown when token generation fails.
 */
export class TokenGenerationError extends FavaLibError {}

/**
 * Error thrown when an unexpected error occurs during cryptographic operations.
 */
export class CryptoError extends FavaLibError {}

/**
 * Error thrown when an unexpected error occurs during export/import operations.
 */
export class ExportImportError extends FavaLibError {}

/**
 * Error thrown when an unexpected error occurs during synchronization.
 */
export class SyncError extends FavaLibError {}

/**
 * Error thrown when synchronization is in the wrong state for the operation.
 */
export class SyncInWrongStateError extends SyncError {
  /**
   * @inheritdoc
   */
  constructor(message?: string) {
    super(message ?? 'Unexpected state while syncing')
    this.name = 'FavaLibError'
  }
}

/**
 * Error thrown when starting an add device flow while a previous one is still active.
 */
export class SyncAddDeviceFlowConflictError extends SyncError {
  /**
   * @inheritdoc
   */
  constructor(message?: string) {
    super(
      message ??
        "Can't start an add device flow while a previous one is still active",
    )
    this.name = 'FavaLibError'
  }
}

/**
 * Error thrown when attempting a sync operation when there is no server connection.
 */
export class SyncNoServerConnectionError extends SyncError {
  /**
   * @inheritdoc
   */
  constructor(message?: string) {
    super(message ?? 'No server connection available')
    this.name = 'FavaLibError'
  }
}

/**
 * Error thrown when the other device in an add-device pairing speaks a JPAKE
 * wire version this build cannot complete an exchange with.
 */
export class SyncPairingVersionError extends SyncError {}

/**
 * Error thrown when an invalid command is being executed.
 */
export class InvalidCommandError extends FavaLibError {}

/**
 * Error thrown when a stored vault's storageVersion is newer than this build
 * can read, or is not a valid version at all.
 *
 * The sibling below is the other direction, and the two are separate classes
 * because the advice is opposite: this one means upgrade the software, that one
 * means the software cannot be upgraded far enough backwards to help.
 */
export class StorageVersionError extends InitializationError {}

/**
 * Error thrown when a stored vault's storageVersion is older than the format
 * this build reads.
 *
 * There is no migration, by design: a vault predating the current format is
 * refused, and the way across is to open it with the older build, export the
 * entries and import them here. See key-hierarchy-review/18-anti-rollback.md
 * for why reading the old format at all was the wider problem.
 */
export class UnsupportedStorageVersionError extends InitializationError {}
