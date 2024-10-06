// eslint-disable-next-line no-restricted-globals
export class JPakeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JPakeError'
  }
}

export class InvalidStateError extends JPakeError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidStateError'
  }
}

export class InvalidArgumentError extends JPakeError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidArgumentError'
  }
}

export class VerificationError extends JPakeError {
  constructor(message: string) {
    super(message)
    this.name = 'VerificationError'
  }
}
