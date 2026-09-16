import { getFavaLibVaultCreationUtils } from 'favalib'
import BrowserPlatformProvider from 'favalib/platformProviders/browser'

import { deviceType, passwordExtraDict, syncServerUrl } from '../parameters'

/**
 * favalib's vault factory, bound to this client's identity.
 *
 * Mirrors `../../app-browser/src/utils/creationUtils.ts`. The save function is
 * a throwing placeholder on purpose: the real one needs the `FavaLib` instance
 * it is saving, so `VaultContainer` installs it with
 * `favaLib.storage.setSaveFunction()` the moment an instance exists. Reaching
 * a vault write before that is a bug, and throwing is how it gets noticed.
 *
 * `BrowserPlatformProvider` runs in the background service worker as well as
 * the popup: its `CryptoLib` reads WebCrypto off `globalThis`, and its
 * `QrCodeLib` only touches the dom in `getImageDataFromInput`, which is the
 * *reading* path and is never taken -- this client pairs by text.
 */
const favaLibVaultCreationUtils = getFavaLibVaultCreationUtils(
  BrowserPlatformProvider,
  deviceType,
  passwordExtraDict,
  () => {
    throw new Error('saveFunction was not initialised')
  },
  syncServerUrl,
)

export default favaLibVaultCreationUtils
