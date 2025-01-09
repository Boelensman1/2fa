import fs from 'node:fs/promises'
import { Option } from 'clipanion'
import { confirm } from '@inquirer/prompts'

import BaseCommand from '../../BaseCommand.mjs'

class VaultDeleteCommand extends BaseCommand {
  static override paths = [['vault', 'delete']]

  requireTwoFaLib = false

  static usage = BaseCommand.Usage({
    category: 'Vault',
    description: 'Delete the current vault',
    details: `
      This command deletes the current vault file.
      You will be asked to confirm before deletion.
    `,
    examples: [['Delete the current vault', 'vault delete']],
  })

  force = Option.Boolean('--force', {
    description: 'Delete the vault without confirmation',
  })

  async exec() {
    if (!this.force) {
      const shouldDelete = await confirm({
        message:
          'Are you sure you want to delete the vault? This action cannot be undone.',
        default: false,
      })

      if (!shouldDelete) {
        this.output('Vault deletion cancelled.\n')
        return { success: false, cancelled: true }
      }
    }

    await fs.rm(this.settings.vaultLocation)
    this.output('Vault deleted successfully.\n')
    return { success: true }
  }
}

export default VaultDeleteCommand
