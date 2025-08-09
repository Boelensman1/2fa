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

  const password = (await keytar.getPassword(
    'favacli',
    'vault-password',
  )) as Password

  const favaLib =
    await favaLibVaultCreationUtils.loadFavaLibFromLockedRepesentation(
      vaultData,
      password,
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
