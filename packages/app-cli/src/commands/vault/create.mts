import fs from 'node:fs/promises'
import keytar from 'keytar'

import BaseCommand from '../../BaseCommand.mjs'

import { DeviceType, getTwoFaLibVaultCreationUtils, Password } from 'favalib'
import NodePlatformProvider from 'favalib/platformProviders/node'
import { password as passwordInput } from '@inquirer/prompts'

class VaultCreateCommand extends BaseCommand {
  static override paths = [['vault', 'create']]

  requireTwoFaLib = false

  static usage = BaseCommand.Usage({
    category: 'Vault',
    description: 'Create a new encrypted vault',
    details: `
      This command creates a new encrypted vault file to store your 2FA entries.

      You will be prompted to enter a password that will be used to encrypt the vault.
      The password will be securely stored in your system's keychain.
    `,
    examples: [['Create a new vault', 'vault create']],
  })

  async exec() {
    const twoFaLibVaultCreationUtils = getTwoFaLibVaultCreationUtils(
      NodePlatformProvider,
      'cli' as DeviceType,
      ['cli'],
      (newLockedRepresentationString) =>
        fs.writeFile(
          this.settings.vaultLocation,
          newLockedRepresentationString,
        ),
    )

    const password = (await passwordInput({
      message: 'Enter your vault password:',
      mask: '*',
    })) as Password

    const repeatPassword = (await passwordInput({
      message: 'Repeat your vault password:',
      mask: '*',
    })) as Password

    if (password != repeatPassword) {
      throw new Error("Passwords don't match")
    }

    const { twoFaLib } =
      await twoFaLibVaultCreationUtils.createNewTwoFaLibVault(password)

    await Promise.all([
      twoFaLib.storage.forceSave(),
      keytar.setPassword('favacli', 'vault-password', password),
    ])
    return { success: true }
  }
}

export default VaultCreateCommand
