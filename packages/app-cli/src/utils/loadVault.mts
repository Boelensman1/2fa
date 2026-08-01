import fs from 'node:fs/promises'
import keytar from 'keytar'

import {
  DeviceType,
  getFavaLibVaultCreationUtils,
  type LockedRepresentationString,
  Password,
  SaveFunction,
  FavaLibEvent,
} from 'favalib'
import NodePlatformProvider from 'favalib/platformProviders/node'
import { Settings } from './init.mjs'

const loadVault = async (
  vaultData: LockedRepresentationString,
  settings: Settings,
  addError: (err: Error) => void,
  verbose = false,
  connectToSyncServer = true,
) => {
  const saveFunction: SaveFunction = async (newLockedRepresentationString) => {
    const tempFile = `${settings.vaultLocation}.tmp`
    const backupFile = `${settings.vaultLocation}.backup`
    try {
      // Write to temporary file first, so we don't have to worry about partial writes
      await fs.writeFile(tempFile, newLockedRepresentationString)

      // Create backup of existing vault if it exists
      try {
        await fs.copyFile(settings.vaultLocation, backupFile)
      } catch (err) {
        // If the error is not because the original file doesn't exist yet, throw it
        if (err instanceof Error && 'code' in err && err.code !== 'ENOENT')
          throw err
      }

      // Atomically rename temp file to target file
      await fs.rename(tempFile, settings.vaultLocation)
    } catch (error) {
      // Clean up temp file if something went wrong
      await fs.unlink(tempFile).catch((err) => {
        console.error('Failed to clean up temp file:', err)
      })
      throw error
    }
  }

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

  const favaLib =
    await favaLibVaultCreationUtils.loadFavaLibFromLockedRepesentation(
      vaultData,
      password,
      { connectToSyncServer },
    )
  favaLib.addEventListener(FavaLibEvent.Log, (ev) => {
    if (ev.detail.severity === 'warning') {
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
