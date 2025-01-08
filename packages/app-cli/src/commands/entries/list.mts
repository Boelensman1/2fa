import { Option } from 'clipanion'

import BaseListOutputCommand from '../../BaseListOutputCommand.mjs'

class EntriesListCommand extends BaseListOutputCommand {
  static override paths = [['entries', 'list']]

  static usage = BaseListOutputCommand.Usage({
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

  getList() {
    let entries
    if (this.withTokens) {
      entries = this.twoFaLib.vault.listEntriesMetas(true)
    } else {
      entries = this.twoFaLib.vault.listEntriesMetas(false)
    }

    return entries
  }
}

export default EntriesListCommand
