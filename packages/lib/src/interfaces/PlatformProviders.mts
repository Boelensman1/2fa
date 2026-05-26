import type CryptoLib from './CryptoLib.mjs'
import type { QrCodeLib } from './QrCodeLib.mjs'
import type { OpenPgpLib } from './OpenPgpLib.mjs'
import type { UrlParser } from './UrlParserLib.mjs'

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
   * URL parser factory. Returns a function that parses OTP URIs into their
   * components. Platform-specific so environments without a reliable native
   * `URL` can supply their own (e.g. backed by `whatwg-url`).
   */
  UrlParserLib: () => UrlParser
  /**
   * genUuidV4 function
   */
  genUuidV4: () => string
}

export default PlatformProviders
