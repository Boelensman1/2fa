import fs from 'node:fs/promises'
import keytar from 'keytar'

import {
  DeviceType,
  getTwoFaLibVaultCreationUtils,
  type LockedRepresentationString,
  Passphrase,
  TwoFaLibEvent,
} from 'favalib'
import NodeCryptoProvider from 'favalib/cryptoProviders/node'
import { Settings } from './init.mjs'

const cryptoLib = new NodeCryptoProvider()
const twoFaLibVaultCreationUtils = getTwoFaLibVaultCreationUtils(
  cryptoLib,
  'cli' as DeviceType,
  ['cli'],
)

const loadVault = async (
  vaultData: LockedRepresentationString,
  settings: Settings,
  verbose = false,
) => {
  const passphrase = (await keytar.getPassword(
    'favacli',
    'vault-passphrase',
  )) as Passphrase

  const twoFaLib =
    await twoFaLibVaultCreationUtils.loadTwoFaLibFromLockedRepesentation(
      vaultData,
      passphrase,
    )
  twoFaLib.addEventListener(TwoFaLibEvent.Changed, async (ev) => {
    const tempFile = `${settings.vaultLocation}.tmp`
    try {
      // Write to temporary file first, so we don't have to worry about partial writes
      await fs.writeFile(tempFile, ev.detail.newLockedRepresentationString)
      // Atomically rename temp file to target file
      await fs.rename(tempFile, settings.vaultLocation)
    } catch (error) {
      // Clean up temp file if something went wrong
      await fs.unlink(tempFile).catch((err) => {
        console.error(err)
      })
      throw error
    }
  })
  twoFaLib.addEventListener(TwoFaLibEvent.Log, (ev) => {
    if (ev.detail.severity !== 'info' || verbose) {
      console.log(ev.detail)
    }
  })

  await twoFaLib.ready

  return twoFaLib
}

export default loadVault
