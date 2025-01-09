import { Option } from 'clipanion'

import BaseListOutputCommand from '../../BaseListOutputCommand.mjs'

class EntriesSearchCommand extends BaseListOutputCommand {
  static override paths = [['entries', 'search']]

  static usage = BaseListOutputCommand.Usage({
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

  getList() {
    if (this.withTokens) {
      return this.twoFaLib.vault.searchEntriesMetas(this.query, true)
    } else {
      return this.twoFaLib.vault.searchEntriesMetas(this.query, false)
    }
  }
}

export default EntriesSearchCommand
