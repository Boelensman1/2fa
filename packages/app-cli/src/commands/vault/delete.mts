import fs from 'node:fs/promises'
import { Option } from 'clipanion'
import { input } from '@inquirer/prompts'

import BaseCommand from '../../BaseCommand.mjs'

class VaultDeleteCommand extends BaseCommand {
  static override paths = [['vault', 'delete']]

  requireFavaLib = false

  static usage = BaseCommand.Usage({
    category: 'Vault',
    description: 'Delete the current vault',
    details: `
      This command deletes the current vault file.
      You will be asked to type "destructive" to confirm before deletion.
    `,
    examples: [['Delete the current vault', 'vault delete']],
  })

  force = Option.Boolean('--force', {
    description: 'Delete the vault without confirmation',
  })

  async exec() {
    if (!this.force) {
      this.context.stderr.write(
        'WARNING: This deletes the current vault, its backup and any temporary\n',
      )
      this.context.stderr.write(
        'copy. The 2FA secrets it holds cannot be recovered afterwards.\n',
      )

      const confirmation = await input({
        message: 'Type "destructive" to confirm deletion of the vault:',
      })

      if (confirmation !== 'destructive') {
        this.output('Vault deletion cancelled.\n')
        return { success: false, cancelled: true }
      }
    }

    await fs.rm(this.settings.vaultLocation)

    // The backup and any stale temp file hold the same secrets as the vault,
    // and loadVault writes a backup on every save without ever removing one.
    // Leaving them after an explicit delete means the vault is not actually
    // deleted -- and copying the backup back over vault.json silently reverts
    // it, which an AEAD cannot detect.
    for (const leftover of [
      `${this.settings.vaultLocation}.backup`,
      `${this.settings.vaultLocation}.tmp`,
    ]) {
      await fs.rm(leftover, { force: true })
    }

    this.output('Vault deleted successfully.\n')
    return { success: true }
  }
}

export default VaultDeleteCommand
