import { getTwoFaLibVaultCreationUtils } from 'favalib'
import BrowserPlatformProvider from 'favalib/platformProviders/browser'

import { deviceType, passwordExtraDict, syncServerUrl } from '../parameters'

const twoFaLibVaultCreationUtils = getTwoFaLibVaultCreationUtils(
  BrowserPlatformProvider,
  deviceType,
  passwordExtraDict,
  () => {
    throw new Error('savefunction was not initialised')
  }, // savefunction is set in create/login components
  syncServerUrl,
)

export default twoFaLibVaultCreationUtils
