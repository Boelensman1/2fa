import fs from 'node:fs/promises'
import keytar from 'keytar'

import {
  DeviceType,
  getTwoFaLibVaultCreationUtils,
  type LockedRepresentationString,
  Passphrase,
  TwoFaLibEvent,
} from '2falib'
import NodeCryptoProvider from '2falib/cryptoProviders/node'

const cryptoLib = new NodeCryptoProvider()
const twoFaLibVaultCreationUtils = getTwoFaLibVaultCreationUtils(
  cryptoLib,
  'cli' as DeviceType,
  ['cli'],
)

const loadVault = async (
  vaultData: LockedRepresentationString,
  verbose = false,
) => {
  const passphrase = (await keytar.getPassword(
    '2falib',
    'vault-passphrase',
  )) as Passphrase

  const twoFaLib =
    await twoFaLibVaultCreationUtils.loadTwoFaLibFromLockedRepesentation(
      vaultData,
      passphrase,
    )
  twoFaLib.addEventListener(TwoFaLibEvent.Changed, (ev) => {
    return fs.writeFile('vault.json', ev.detail.newLockedRepresentationString)
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
