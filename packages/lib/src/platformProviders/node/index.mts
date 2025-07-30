import type { PlatformProviders } from '../../interfaces/PlatformProviders.mjs'
import NodeCryptoLib from './cryptoLib.mjs'
import { NodeQrCodeLib } from './qrCodeLib.mjs'
import { NodeOpenPgpLib } from './openPgpLib.mjs'
import { v4 as genUuidV4 } from 'uuid'

/**
 * Node.js-specific platform providers
 */
export const nodeProviders: PlatformProviders = {
  CryptoLib: NodeCryptoLib,
  WebSocketLib: () => WebSocket,
  QrCodeLib: NodeQrCodeLib,
  OpenPgpLib: NodeOpenPgpLib,
  genUuidV4: () => genUuidV4(),
}

export default nodeProviders
