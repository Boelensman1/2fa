import { getFavaLibVaultCreationUtils } from 'favalib'
import BrowserPlatformProvider from 'favalib/platformProviders/browser'

import { deviceType, passwordExtraDict, syncServerUrl } from '../parameters'
import saveFunction from './saveFunction'

const favaLibVaultCreationUtils = getFavaLibVaultCreationUtils(
  BrowserPlatformProvider,
  deviceType,
  passwordExtraDict,
  saveFunction,
  syncServerUrl,
)

export default favaLibVaultCreationUtils
