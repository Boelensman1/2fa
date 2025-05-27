import fs from 'node:fs/promises'
import keytar from 'keytar'

import {
  DeviceType,
  getTwoFaLibVaultCreationUtils,
  type LockedRepresentationString,
  Passphrase,
  SaveFunction,
  TwoFaLibEvent,
} from 'favalib'
import NodeCryptoProvider from 'favalib/cryptoProviders/node'
import { Settings } from './init.mjs'

const cryptoLib = new NodeCryptoProvider()

const loadVault = async (
  vaultData: LockedRepresentationString,
  settings: Settings,
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

  const twoFaLibVaultCreationUtils = getTwoFaLibVaultCreationUtils(
    cryptoLib,
    'cli' as DeviceType,
    ['cli'],
    saveFunction,
  )

  const passphrase = (await keytar.getPassword(
    'favacli',
    'vault-passphrase',
  )) as Passphrase

  const twoFaLib =
    await twoFaLibVaultCreationUtils.loadTwoFaLibFromLockedRepesentation(
      vaultData,
      passphrase,
    )
  twoFaLib.addEventListener(TwoFaLibEvent.Log, (ev) => {
    if (ev.detail.severity !== 'info' || verbose) {
      console.log(ev.detail)
    }
  })

  await twoFaLib.ready

  return twoFaLib
}

export default loadVault
