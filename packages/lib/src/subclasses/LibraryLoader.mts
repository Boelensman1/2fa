import type CryptoLib from '../interfaces/CryptoLib.js'

class LibraryLoader {
  // libraries that are always loaded
  private cryptoLib: CryptoLib

  // libraries are loaded on demand
  private openPgpLib?: typeof import('openpgp')
  private qrGeneratorLib?: typeof import('qrcode')
  private jsQrLib?: typeof import('jsqr').default
  private canvasLib?: typeof import('canvas')
  private urlParserLib?: typeof import('whatwg-url')

  constructor(cryptoLib: CryptoLib) {
    if (!cryptoLib) {
      throw new Error('CryptoLib is required')
    }
    this.cryptoLib = cryptoLib
  }

  getCryptoLib() {
    return this.cryptoLib
  }

  async getOpenPGPLib() {
    if (!this.openPgpLib) {
      const module = await import('openpgp')
      this.openPgpLib = module
    }
    return this.openPgpLib
  }

  async getQrGeneratorLib() {
    if (!this.qrGeneratorLib) {
      const module = await import('qrcode')
      this.qrGeneratorLib = module.default
    }
    return this.qrGeneratorLib
  }

  async getJsQrLib() {
    if (!this.jsQrLib) {
      const module = await import('jsqr')
      this.jsQrLib = module.default.default
    }
    return this.jsQrLib
  }

  async getCanvasLib() {
    if (typeof window !== 'undefined') {
      throw new Error('Canvas lib can not be loaded in browser env')
    }

    if (!this.canvasLib) {
      const module = await import('canvas')
      this.canvasLib = module.default
    }
    return this.canvasLib
  }

  async getUrlParserLib() {
    if (!this.urlParserLib) {
      const module = await import('whatwg-url')
      this.urlParserLib = module.default
    }
    return this.urlParserLib
  }
}

export default LibraryLoader
