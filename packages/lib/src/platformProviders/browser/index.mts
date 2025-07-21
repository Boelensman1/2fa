import type { PlatformProviders } from '../../interfaces/PlatformProviders.mjs'
import BrowserCryptoLib from './cryptoLib.mjs'
import { BrowserQrCodeLib } from './qrCodeLib.mjs'
import { BrowserOpenPgpLib } from './openPgpLib.mjs'

/**
 * Browser-specific platform providers
 */
export const browserProviders: PlatformProviders = {
  CryptoLib: BrowserCryptoLib,
  WebSocketLib: () => WebSocket,
  QrCodeLib: BrowserQrCodeLib,
  OpenPgpLib: BrowserOpenPgpLib,
}

export default browserProviders
