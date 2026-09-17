import { getFavaLibVaultCreationUtils } from 'favalib'
import BrowserPlatformProvider from 'favalib/platformProviders/browser'

import { deviceType, passwordExtraDict } from '../parameters'
import saveFunction from './saveFunction'

// No sync server here any more. A vault is created with sync switched off and
// configured afterwards through SyncServerForm, because the server needs a
// shared secret that only the user can supply -- see ../parameters.ts.
const favaLibVaultCreationUtils = getFavaLibVaultCreationUtils(
  BrowserPlatformProvider,
  deviceType,
  passwordExtraDict,
  saveFunction,
)

export default favaLibVaultCreationUtils
