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
