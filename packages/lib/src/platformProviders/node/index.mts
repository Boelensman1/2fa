import type { PlatformProviders } from '../../interfaces/PlatformProviders.mjs'
import NodeCryptoLib from './cryptoLib.mjs'
import { NodeQrCodeLib } from './qrCodeLib.mjs'
import { NodeOpenPgpLib } from './openPgpLib.mjs'
import { nativeUrlParser } from '../shared/urlParserLib.mjs'
import { v4 as genUuidV4 } from 'uuid'

/**
 * Node.js-specific platform providers
 */
export const nodeProviders: PlatformProviders = {
  CryptoLib: NodeCryptoLib,
  WebSocketLib: () => WebSocket,
  QrCodeLib: NodeQrCodeLib,
  OpenPgpLib: NodeOpenPgpLib,
  UrlParserLib: () => nativeUrlParser,
  genUuidV4: () => genUuidV4(),
}

export default nodeProviders
