import type CryptoLib from './CryptoLib.mjs'

/**
 * Interface for platform-specific providers
 * Currently includes crypto providers, with potential for future expansion
 */
export interface PlatformProviders {
  /**
   * Cryptographic operations provider
   */
  CryptoLib: new () => CryptoLib
}

export default PlatformProviders
