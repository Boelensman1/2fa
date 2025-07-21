import type { PlatformProviders } from '../../interfaces/PlatformProviders.mjs'
import BrowserCryptoLib from './cryptoLib.mjs'

/**
 * Browser-specific platform providers
 */
export const browserProviders: PlatformProviders = {
  CryptoLib: BrowserCryptoLib,
}

export default browserProviders
