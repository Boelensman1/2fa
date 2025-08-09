import type CryptoLib from '../interfaces/CryptoLib.mjs'
import type { PlatformProviders } from '../interfaces/PlatformProviders.mjs'
import type { QrCodeLib } from '../interfaces/QrCodeLib.mjs'
import type { OpenPgpLib } from '../interfaces/OpenPgpLib.mjs'
import { InitializationError } from '../FavaLibError.mjs'

/**
 * Class responsible for loading various external (big) libraries required by the application.
 * All libraries (except CryptoLib) are loaded on demand. This helps to reduce the initial bundle size.
 */
class LibraryLoader {
  // libraries that are always loaded
  private platformProviders: PlatformProviders
  private cryptoLib: CryptoLib

  // libraries that are loaded on demand
  private openPgpLib?: OpenPgpLib
  private qrGeneratorLib?: QrCodeLib
  private jsQrLib?: typeof import('jsqr').default
  private urlParserLib?: typeof import('whatwg-url')
  private zxcvbn?: typeof import('@zxcvbn-ts/core').zxcvbn
  private webSocketLib?: typeof WebSocket

  /**
   * Constructs a new instance of LibraryLoader.
   * @param platformProviders - Platform-specific providers containing CryptoLib and other providers.
   * @throws {InitializationError} If the provided platform providers are invalid.
   */
  constructor(platformProviders: PlatformProviders) {
    if (!platformProviders?.CryptoLib) {
      throw new InitializationError(
        'PlatformProviders with CryptoLib is required',
      )
    }
    this.platformProviders = platformProviders
    this.cryptoLib = new platformProviders.CryptoLib()
  }

  /**
   * @returns The CryptoLib instance.
   */
  getCryptoLib() {
    return this.cryptoLib
  }

  /**
   * @returns The PlatformProviders instance.
   */
  getPlatformProviders() {
    return this.platformProviders
  }

  /**
   * Loads and returns the OpenPGP library on demand.
   * @returns A promise that resolves to the OpenPGP library.
   */
  getOpenPGPLib() {
    this.openPgpLib ??= new this.platformProviders.OpenPgpLib()
    return this.openPgpLib
  }

  /**
   * Loads and returns the QR Generator library on demand.
   * @returns A promise that resolves to the QR Generator library.
   */
  getQrGeneratorLib() {
    this.qrGeneratorLib ??= new this.platformProviders.QrCodeLib()
    return this.qrGeneratorLib
  }

  /**
   * Loads and returns the JsQR library on demand.
   * @returns A promise that resolves to the JsQR library.
   */
  async getJsQrLib() {
    if (!this.jsQrLib) {
      const module = await import('jsqr')
      this.jsQrLib = module.default.default
    }
    return this.jsQrLib
  }

  /**
   * Loads and returns the URL Parser library on demand.
   * @returns A promise that resolves to the URL Parser library.
   */
  async getUrlParserLib() {
    if (!this.urlParserLib) {
      const module = await import('whatwg-url')
      this.urlParserLib = module.default
    }
    return this.urlParserLib
  }

  /**
   * Loads and returns the WebSocket library on demand.
   * @returns The WebSocket library.
   */
  getWebSocketLib() {
    this.webSocketLib ??= this.platformProviders.WebSocketLib()
    return this.webSocketLib
  }

  /**
   * Loads and returns the Zxcvbn library on demand.
   * @returns A promise that resolves to the Zxcvbn library.
   */
  async getZxcvbn() {
    if (!this.zxcvbn) {
      const { zxcvbn, zxcvbnOptions } = await import('@zxcvbn-ts/core')
      const zxcvbnCommonPackage = await import('@zxcvbn-ts/language-common')
      const zxcvbnEnPackage = await import('@zxcvbn-ts/language-en')
      const options = {
        translations: zxcvbnEnPackage.translations,
        graphs: zxcvbnCommonPackage.adjacencyGraphs,
        dictionary: {
          ...zxcvbnCommonPackage.dictionary,
          ...zxcvbnEnPackage.dictionary,
        },
      }

      zxcvbnOptions.setOptions(options)

      this.zxcvbn = zxcvbn
    }
    return this.zxcvbn
  }
}

export default LibraryLoader
