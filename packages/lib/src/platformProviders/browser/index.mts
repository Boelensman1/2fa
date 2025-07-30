import type { PlatformProviders } from '../../interfaces/PlatformProviders.mjs'
import BrowserCryptoLib from './cryptoLib.mjs'
import { BrowserQrCodeLib } from './qrCodeLib.mjs'
import { BrowserOpenPgpLib } from './openPgpLib.mjs'
import { v4 as genUuidV4 } from 'uuid'

/**
 * Browser-specific platform providers
 */
export const browserProviders: PlatformProviders = {
  CryptoLib: BrowserCryptoLib,
  WebSocketLib: () => WebSocket,
  QrCodeLib: BrowserQrCodeLib,
  OpenPgpLib: BrowserOpenPgpLib,
  genUuidV4: () => genUuidV4(),
}

export default browserProviders
