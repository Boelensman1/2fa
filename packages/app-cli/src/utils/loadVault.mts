import keytar from 'keytar'

import {
  DeviceType,
  getFavaLibVaultCreationUtils,
  type LockedRepresentationString,
  Password,
  FavaLibEvent,
  StorageVersionError,
  UnsupportedStorageVersionError,
  type LoadFavaLibOptions,
} from 'favalib'
import NodePlatformProvider from 'favalib/platformProviders/node'
import { Settings } from './init.mjs'
import createVaultSaveFunction from './vaultSaveFunction.mjs'

const loadVault = async (
  vaultData: LockedRepresentationString,
  settings: Settings,
  addError: (err: Error) => void,
  verbose = false,
  options: LoadFavaLibOptions = {},
) => {
  const saveFunction = createVaultSaveFunction(settings.vaultLocation)

  const favaLibVaultCreationUtils = getFavaLibVaultCreationUtils(
    NodePlatformProvider,
    'cli' as DeviceType,
    ['cli'],
    saveFunction,
  )

  let storedPassword: string | null
  try {
    storedPassword = await keytar.getPassword('favacli', 'vault-password')
  } catch (err) {
    throw new Error(
      `Failed to read the vault password from the system keychain: ${
        err instanceof Error ? err.message : String(err)
      }. Make sure your OS keychain service is available (on Linux this requires a ` +
        `Secret Service provider such as gnome-keyring or KWallet via libsecret).`,
    )
  }

  if (!storedPassword) {
    throw new Error(
      `No vault password found in the system keychain. The vault file at ` +
        `"${settings.vaultLocation}" exists, but the password used to decrypt it is not ` +
        `stored on this device. This usually happens when the vault was copied from another ` +
        `device or the keychain entry was removed. Run "favacli vault restore-password" to ` +
        `re-store it.`,
    )
  }

  const password = storedPassword as Password

  let favaLib
  try {
    favaLib =
      await favaLibVaultCreationUtils.loadFavaLibFromLockedRepesentation(
        vaultData,
        password,
        options,
      )
  } catch (err) {
    if (err instanceof UnsupportedStorageVersionError) {
      throw new Error(
        `The vault at "${settings.vaultLocation}" was saved in an older storage ` +
          `format that this version of favacli cannot read, and there is no ` +
          `automatic upgrade. Open it with the version of favacli that wrote ` +
          `it, export your entries with "favacli export text", and import them ` +
          `here. Your data is intact — do not delete the vault or its backup. ` +
          `(${err.message})`,
      )
    }
    if (err instanceof StorageVersionError) {
      throw new Error(
        `The vault at "${settings.vaultLocation}" was saved by a newer version of ` +
          `favacli than the one you are running, so this version cannot read it ` +
          `safely. Upgrade favacli and try again. Your data is intact — do not ` +
          `delete the vault or its backup. (${err.message})`,
      )
    }
    throw err
  }
  favaLib.addEventListener(FavaLibEvent.Log, (ev) => {
    if (ev.detail.severity === 'warning' || ev.detail.severity === 'error') {
      addError(new Error(ev.detail.message))
      return
    }
    if (ev.detail.severity !== 'info' || verbose) {
      console.log(ev.detail.message)
    }
  })

  await favaLib.ready

  return favaLib
}

export default loadVault
