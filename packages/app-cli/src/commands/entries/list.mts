import { Option } from 'clipanion'
import type { JsonArray } from 'type-fest'

import BaseCommand from '../../BaseCommand.mjs'
import generateEntriesTable from '../../utils/generateEntriesTable.mjs'

class EntriesListCommand extends BaseCommand {
  static override paths = [['entries', 'list']]

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
