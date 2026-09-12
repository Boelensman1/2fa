import { Option } from 'clipanion'

import BaseListOutputCommand from '../../BaseListOutputCommand.mjs'

class EntriesFindForUrlCommand extends BaseListOutputCommand {
  static override paths = [['entries', 'find-for-url']]

  static usage = BaseListOutputCommand.Usage({
    category: 'Entries',
    description: 'List the entries whose matchers cover a url',
    details: `
      This command shows which stored entries belong to a site, in the order a
      client should prefer them: the most specific matcher first.

      An entry with no matchers is never returned, and a url that cannot be
      matched against - one that does not parse, or whose scheme is not http or
      https - yields no entries rather than an error.
    `,
    examples: [
      [
        'Find the entries for a site',
        'entries find-for-url https://github.com/login',
      ],
      [
        'Find the entries for a site, with their current tokens',
        'entries find-for-url https://github.com/login --withTokens',
      ],
    ],
  })

  requireFavaLib = true

  url = Option.String({ required: true })

  withTokens = Option.Boolean('--withTokens', {
    description: 'Include current TOTP tokens in the output',
  })

  async getList() {
    if (this.withTokens) {
      return this.favaLib.vault.findEntryMetasForUrl(this.url, true)
    }
    return this.favaLib.vault.findEntryMetasForUrl(this.url, false)
  }
}

export default EntriesFindForUrlCommand
