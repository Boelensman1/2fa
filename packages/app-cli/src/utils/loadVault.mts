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
  twoFaLib.addEventListener(TwoFaLibEvent.Changed, (ev) => {
    return fs.writeFile(
      settings.vaultLocation,
      ev.detail.newLockedRepresentationString,
    )
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
