import fs from 'node:fs/promises'
import { Command } from '@oclif/core'
import inquirer from 'inquirer'
import keytar from 'keytar'

import {
  DeviceType,
  getTwoFaLibVaultCreationUtils,
  Passphrase,
  TwoFaLibEvent,
} from '2falib'
import NodeCryptoProvider from '2falib/cryptoProviders/node'
import init from '../../init.js'

const cryptoLib = new NodeCryptoProvider()
const twoFaLibVaultCreationUtils = getTwoFaLibVaultCreationUtils(
  cryptoLib,
  'cli' as DeviceType,
  ['cli'],
)

export default class VaultCreate extends Command {
  static override args = {}

  static override description = 'Create a new vault'

  static override examples = ['<%= config.bin %> <%= command.id %>']

  static override flags = {}

  public async run(): Promise<void> {
    await init()

    const result = await inquirer.prompt([
      {
        type: 'password',
        name: 'passphrase',
        message: 'Enter your vault passphrase:',
        mask: '*',
      },
    ])
    const passphrase = result.passphrase as Passphrase

    // Now you can use the passphrase with your vault creation utils
    const { twoFaLib } =
      await twoFaLibVaultCreationUtils.createNewTwoFaLibVault(passphrase)

    twoFaLib.addEventListener(TwoFaLibEvent.Changed, (ev) => {
      return fs.writeFile('vault.json', ev.detail.newLockedRepresentationString)
    })
    await Promise.all([
      twoFaLib.forceSave(),
      keytar.setPassword('2falib', 'vault-passphrase', passphrase),
    ])
  }
}
