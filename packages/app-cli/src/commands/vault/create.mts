import fs from 'node:fs/promises'
import keytar from 'keytar'

import BaseCommand from '../../BaseCommand.mjs'

import {
  DeviceType,
  getTwoFaLibVaultCreationUtils,
  Passphrase,
  TwoFaLibEvent,
} from 'favalib'
import NodeCryptoProvider from 'favalib/cryptoProviders/node'
import { password } from '@inquirer/prompts'

const cryptoLib = new NodeCryptoProvider()
const twoFaLibVaultCreationUtils = getTwoFaLibVaultCreationUtils(
  cryptoLib,
  'cli' as DeviceType,
  ['cli'],
)

class VaultCreateCommand extends BaseCommand {
  static override paths = [['vault', 'create']]

  requireTwoFaLib = false

  async exec() {
    const passphrase = (await password({
      message: 'Enter your vault passphrase:',
      mask: '*',
    })) as Passphrase
    const { twoFaLib } =
      await twoFaLibVaultCreationUtils.createNewTwoFaLibVault(passphrase)

    twoFaLib.addEventListener(TwoFaLibEvent.Changed, (ev) => {
      return fs.writeFile('vault.json', ev.detail.newLockedRepresentationString)
    })
    await Promise.all([
      twoFaLib.forceSave(),
      keytar.setPassword('2falib', 'vault-passphrase', passphrase),
    ])
    return { success: true }
  }
}

export default VaultCreateCommand
