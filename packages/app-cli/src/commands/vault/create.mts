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

  static usage = BaseCommand.Usage({
    category: 'Vault',
    description: 'Create a new encrypted vault',
    details: `
      This command creates a new encrypted vault file to store your 2FA entries.

      You will be prompted to enter a passphrase that will be used to encrypt the vault.
      The passphrase will be securely stored in your system's keychain.
    `,
    examples: [['Create a new vault', 'vault create']],
  })

  async exec() {
    const passphrase = (await password({
      message: 'Enter your vault passphrase:',
      mask: '*',
    })) as Passphrase

    const repeatPassphrase = (await password({
      message: 'Repeat your vault passphrase:',
      mask: '*',
    })) as Passphrase

    if (passphrase != repeatPassphrase) {
      throw new Error("Passphrases don't match")
    }

    const { twoFaLib } =
      await twoFaLibVaultCreationUtils.createNewTwoFaLibVault(passphrase)

    twoFaLib.addEventListener(TwoFaLibEvent.Changed, (ev) => {
      return fs.writeFile(
        this.settings.vaultLocation,
        ev.detail.newLockedRepresentationString,
      )
    })
    await Promise.all([
      twoFaLib.forceSave(),
      keytar.setPassword('favacli', 'vault-passphrase', passphrase),
    ])
    return { success: true }
  }
}

export default VaultCreateCommand
