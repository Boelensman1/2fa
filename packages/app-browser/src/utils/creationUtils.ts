import { getTwoFaLibVaultCreationUtils } from '2falib'
import BrowserCryptoProvider from '2falib/cryptoProviders/browser'

import { deviceType, passphraseExtraDict, syncServerUrl } from '../parameters'

const cryptoLib = new BrowserCryptoProvider()
const twoFaLibVaultCreationUtils = getTwoFaLibVaultCreationUtils(
  cryptoLib,
  deviceType,
  passphraseExtraDict,
  syncServerUrl,
)

export default twoFaLibVaultCreationUtils
