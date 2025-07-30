import type CryptoLib from './CryptoLib.mjs'
import type { QrCodeLib } from './QrCodeLib.mjs'
import type { OpenPgpLib } from './OpenPgpLib.mjs'

/**
 * Interface for platform-specific providers
 * Includes platform-specific implementations for various libraries
 */
export interface PlatformProviders {
  /**
   * Cryptographic operations provider
   */
  CryptoLib: new () => CryptoLib
  /**
   * WebSocket library
   */
  WebSocketLib: () => typeof WebSocket
  /**
   * QR code generation library with platform-specific extensions
   */
  QrCodeLib: new () => QrCodeLib
  /**
   * OpenPGP encryption library
   */
  OpenPgpLib: new () => OpenPgpLib
  /**
   * genUuidV4 function
   */
  genUuidV4: () => string
}

export default PlatformProviders
