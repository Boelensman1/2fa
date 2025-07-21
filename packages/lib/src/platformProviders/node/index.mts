import type { PlatformProviders } from '../../interfaces/PlatformProviders.mjs'
import NodeCryptoLib from './cryptoLib.mjs'
import { NodeQrCodeLib } from './qrCodeLib.mjs'
import { NodeOpenPgpLib } from './openPgpLib.mjs'

/**
 * Node.js-specific platform providers
 */
export const nodeProviders: PlatformProviders = {
  CryptoLib: NodeCryptoLib,
  WebSocketLib: () => WebSocket,
  QrCodeLib: NodeQrCodeLib,
  OpenPgpLib: NodeOpenPgpLib,
}

export default nodeProviders
