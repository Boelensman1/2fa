import keytar from 'keytar'

import BaseCommand from '../../BaseCommand.mjs'

import { DeviceType, getFavaLibVaultCreationUtils, Password } from 'favalib'
import NodePlatformProvider from 'favalib/platformProviders/node'
import { password as passwordInput } from '@inquirer/prompts'

class VaultRestorePasswordCommand extends BaseCommand {
  static override paths = [['vault', 'restore-password']]

  requireFavaLib = false

  static usage = BaseCommand.Usage({
    category: 'Vault',
    description: "Store an existing vault's password in the system keychain",
    details: `
      Use this when the vault file exists on this device but its password is not
      stored in the system keychain (e.g. after copying the vault from another
      device, or after the keychain was cleared).

      You will be prompted for the vault password. It is verified against the
      existing vault and, if correct, stored in your system's keychain so other
      commands can decrypt the vault. This does NOT change or re-encrypt the vault.
    `,
    examples: [
      ['Restore the vault password in the keychain', 'vault restore-password'],
    ],
  })

  async exec() {
    if (!this.lockedRepresentationString) {
      throw new Error(
        `No vault found at "${this.settings.vaultLocation}". Run "vault create" to create one.`,
      )
    }

    const password = (await passwordInput({
      message: 'Enter your vault password:',
      mask: '*',
    })) as Password

    // No save function is passed: we only load the vault to validate the
    // password, we never write it back.
    const favaLibVaultCreationUtils = getFavaLibVaultCreationUtils(
      NodePlatformProvider,
      'cli' as DeviceType,
      ['cli'],
    )

    // Validate the entered password by decrypting the existing vault (offline).
    let favaLib
    try {
      favaLib =
        await favaLibVaultCreationUtils.loadFavaLibFromLockedRepesentation(
          this.lockedRepresentationString,
          password,
        )
    } catch (err) {
      if (err instanceof Error && err.message === 'Invalid password') {
        throw new Error('Incorrect password — nothing was stored.')
      }
      throw err
    }

    await keytar.setPassword('favacli', 'vault-password', password)

    // Loading may have opened a sync connection; close it so the process exits.
    if (favaLib.sync) {
      favaLib.sync.closeServerConnection()
    }

    this.output('Vault password stored in the system keychain.\n')
    return { success: true }
  }
}

export default VaultRestorePasswordCommand
