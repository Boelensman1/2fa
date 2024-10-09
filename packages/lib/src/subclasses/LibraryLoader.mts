import type CryptoLib from '../interfaces/CryptoLib.mjs'
import { InitializationError, TwoFALibError } from '../TwoFALibError.mjs'

/**
 * Class responsible for loading various external (big) libraries required by the application.
 * All libraries (except CryptoLib) are loaded on demand. This helps to reduce the initial bundle size.
 */
class LibraryLoader {
  // libraries that are always loaded
  private cryptoLib: CryptoLib

  // libraries that are loaded on demand
  private openPgpLib?: typeof import('openpgp')
  private qrGeneratorLib?: typeof import('qrcode')
  private jsQrLib?: typeof import('jsqr').default
  private canvasLib?: typeof import('canvas')
  private urlParserLib?: typeof import('whatwg-url')

  /**
   * Constructs a new instance of LibraryLoader.
   * @param cryptoLib - An instance of CryptoLib that is required for library operations.
   * @throws {InitializationError} If the provided CryptoLib instance is invalid.
   */
  constructor(cryptoLib: CryptoLib) {
    if (!cryptoLib) {
      throw new InitializationError('CryptoLib is required')
    }
    this.cryptoLib = cryptoLib
  }

  /**
   * @returns The CryptoLib instance.
   */
  getCryptoLib() {
    return this.cryptoLib
  }

  /**
   * Loads and returns the OpenPGP library on demand.
   * @returns A promise that resolves to the OpenPGP library.
   */
  async getOpenPGPLib() {
    if (!this.openPgpLib) {
      const module = await import('openpgp')
      this.openPgpLib = module
    }
    return this.openPgpLib
  }

  /**
   * Loads and returns the QR Generator library on demand.
   * @returns A promise that resolves to the QR Generator library.
   */
  async getQrGeneratorLib() {
    if (!this.qrGeneratorLib) {
      const module = await import('qrcode')
      this.qrGeneratorLib = module.default
    }
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
   * Loads and returns the Canvas library on demand.
   * @returns A promise that resolves to the Canvas library.
   * @throws {TwoFALibError} If the library cannot be loaded in a browser environment.
   */
  async getCanvasLib() {
    if (typeof window !== 'undefined') {
      throw new TwoFALibError('Canvas lib can not be loaded in browser env')
    }

    if (!this.canvasLib) {
      const module = await import('canvas')
      this.canvasLib = module.default
    }
    return this.canvasLib
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
}

export default LibraryLoader
