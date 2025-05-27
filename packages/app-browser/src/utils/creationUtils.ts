import { getTwoFaLibVaultCreationUtils } from 'favalib'
import BrowserCryptoProvider from 'favalib/cryptoProviders/browser'

import { deviceType, passphraseExtraDict, syncServerUrl } from '../parameters'

const cryptoLib = new BrowserCryptoProvider()
const twoFaLibVaultCreationUtils = getTwoFaLibVaultCreationUtils(
  cryptoLib,
  deviceType,
  passphraseExtraDict,
  () => {
    throw new Error('savefunction was not initialised')
  }, // savefunction is set in create/login components
  syncServerUrl,
)

export default twoFaLibVaultCreationUtils
