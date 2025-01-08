import { getTwoFaLibVaultCreationUtils } from 'favalib'
import BrowserCryptoProvider from 'favalib/cryptoProviders/browser'

import { deviceType, passphraseExtraDict, syncServerUrl } from '../parameters'

const cryptoLib = new BrowserCryptoProvider()
const twoFaLibVaultCreationUtils = getTwoFaLibVaultCreationUtils(
  cryptoLib,
  deviceType,
  passphraseExtraDict,
  syncServerUrl,
)

export default twoFaLibVaultCreationUtils
