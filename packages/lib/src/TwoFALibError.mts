export class TwoFALibError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TwoFALibError'
  }
}

export class InitializationError extends TwoFALibError {}
export class AuthenticationError extends TwoFALibError {}
export class EntryNotFoundError extends TwoFALibError {}
export class TokenGenerationError extends TwoFALibError {}

export class CryptoError extends TwoFALibError {}

export class ExportImportError extends TwoFALibError {}
export class SyncError extends TwoFALibError {}

export class SyncInWrongStateError extends SyncError {
  constructor() {
    super('Unexpected state while syncing')
    this.name = 'TwoFALibError'
  }
}
export class SyncAddDeviceFlowConflictError extends SyncError {
  constructor() {
    super("Can't start an add device flow while a previous one is still active")
    this.name = 'TwoFALibError'
  }
}
export class SyncNoServerConnectionError extends SyncError {
  constructor() {
    super('Server connection not available')
    this.name = 'TwoFALibError'
  }
}
