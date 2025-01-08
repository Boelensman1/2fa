import { Option } from 'clipanion'
import type { JsonArray } from 'type-fest'

import BaseCommand from '../../BaseCommand.mjs'
import generateEntriesTable from '../../utils/generateEntriesTable.mjs'

class EntriesListCommand extends BaseCommand {
  static override paths = [['entries', 'list']]

  static usage = BaseCommand.Usage({
    category: 'Entries',
    description: 'List all stored 2FA entries',
    details: `
      This command displays a table of all stored two-factor authentication entries.
      
      When used with --withTokens, it will also show the current TOTP codes for each entry.
    `,
    examples: [
      ['List all entries', 'entries list'],
      ['List entries with current TOTP tokens', 'entries list --withTokens'],
    ],
  })

  requireTwoFaLib = true

  withTokens = Option.Boolean('--withTokens', {
    description: 'Include current TOTP tokens in the output',
  })

  async exec() {
    let entries
    if (this.withTokens) {
      entries = this.twoFaLib.vault.listEntriesMetas(true)
    } else {
      entries = this.twoFaLib.vault.listEntriesMetas(false)
    }

    if (entries.length === 0) {
      this.context.stdout.write('No entries\n')
      return 0
    }

    this.output(generateEntriesTable(entries))
    return Promise.resolve(entries as unknown as JsonArray)
  }
}

export default EntriesListCommand
