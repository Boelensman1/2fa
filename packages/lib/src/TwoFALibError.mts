/* eslint-disable no-restricted-globals */
/**
 * Custom error class for the libs errors.
 */
export class TwoFALibError extends Error {
  /**
   * Creates a new Error.
   * @param message - The error message.
   */
  constructor(message: string) {
    super(message)
    this.name = 'TwoFALibError'
  }
}

/**
 * Error thrown during lib initialization failures.
 */
export class InitializationError extends TwoFALibError {}

/**
 * Error thrown during authentication, e.g. wrong passphrase for locked vault.
 */
export class AuthenticationError extends TwoFALibError {}

/**
 * Error thrown when an entry is requested but not found.
 */
export class EntryNotFoundError extends TwoFALibError {}

/**
 * Error thrown when token generation fails.
 */
export class TokenGenerationError extends TwoFALibError {}

/**
 * Error thrown when an unexpected error occurs during cryptographic operations.
 */
export class CryptoError extends TwoFALibError {}

/**
 * Error thrown when an unexpected error occurs during export/import operations.
 */
export class ExportImportError extends TwoFALibError {}

/**
 * Error thrown when an unexpected error occurs during synchronization.
 */
export class SyncError extends TwoFALibError {}

/**
 * Error thrown when synchronization is in the wrong state for the operation.
 */
export class SyncInWrongStateError extends SyncError {
  /**
   * @inheritdoc
   */
  constructor(message?: string) {
    super(message ?? 'Unexpected state while syncing')
    this.name = 'TwoFALibError'
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
    this.name = 'TwoFALibError'
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
    this.name = 'TwoFALibError'
  }
}

/**
 * Error thrown when an invalid command is being executed.
 */
export class InvalidCommandError extends TwoFALibError {}
