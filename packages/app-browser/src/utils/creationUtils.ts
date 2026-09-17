import { getFavaLibVaultCreationUtils } from 'favalib'
import BrowserPlatformProvider from 'favalib/platformProviders/browser'

import { deviceType, passwordExtraDict, syncServerUrl } from '../parameters'
import saveFunction from './saveFunction'

const favaLibVaultCreationUtils = getFavaLibVaultCreationUtils(
  BrowserPlatformProvider,
  deviceType,
  passwordExtraDict,
  // Loading a legacy vault saves its migration before returning. Login and
  // CreateVault later wrap this saver to also refresh the UI.
  saveFunction,
  syncServerUrl,
)

export default favaLibVaultCreationUtils
