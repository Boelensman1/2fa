import { Option } from 'clipanion'
import type { JsonArray } from 'type-fest'

import BaseCommand from '../../BaseCommand.mjs'

import generateEntriesTable from '../../utils/generateEntriesTable.mjs'

class EntriesSearchCommand extends BaseCommand {
  static override paths = [['entries', 'search']]

  static usage = BaseCommand.Usage({
    category: 'Entries',
    description: 'Search for stored 2FA entries',
    details: `
      This command searches through all stored two-factor authentication entries.
      
      The search query will match against entry names and issuers.
      When used with --withTokens, it will also show the current TOTP codes for matching entries.
    `,
    examples: [
      ['Search for entries containing "google"', 'entries search google'],
      [
        'Search and show current TOTP tokens',
        'entries search google --withTokens',
      ],
    ],
  })

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
