import type { PlatformProviders } from '../../interfaces/PlatformProviders.mjs'
import NodeCryptoLib from './cryptoLib.mjs'

/**
 * Node.js-specific platform providers
 */
export const nodeProviders: PlatformProviders = {
  CryptoLib: NodeCryptoLib,
}

export default nodeProviders
