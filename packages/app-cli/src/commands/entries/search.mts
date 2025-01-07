import { Option } from 'clipanion'
import type { JsonArray } from 'type-fest'

import BaseCommand from '../../BaseCommand.mjs'

import generateEntriesTable from '../../utils/generateEntriesTable.mjs'

class EntriesSearchCommand extends BaseCommand {
  static override paths = [['entries', 'search']]

  requireTwoFaLib = true

  withTokens = Option.Boolean('--withTokens', {
    description: 'Include current TOTP tokens in the output',
  })

  query = Option.String({ required: true })

  async exec() {
    let filteredEntries
    if (this.withTokens) {
      filteredEntries = this.twoFaLib.vault.searchEntriesMetas(this.query, true)
    } else {
      filteredEntries = this.twoFaLib.vault.searchEntriesMetas(
        this.query,
        false,
      )
    }

    if (filteredEntries.length === 0) {
      this.output('No matching entries found.\n')
      return []
    }

    const out = generateEntriesTable(filteredEntries)
    this.output(out)
    return Promise.resolve(filteredEntries as unknown as JsonArray)
  }
}

export default EntriesSearchCommand
