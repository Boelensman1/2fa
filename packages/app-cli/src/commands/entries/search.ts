import { Command, Args, Flags } from '@oclif/core'
import init from '../../init.js'
import loadVault from '../../loadVault.js'
import generateEntriesTable from '../../generateEntriesTable.js'

export default class EntriesSearch extends Command {
  static override description = 'Search for entries in the vault'

  static override examples = ['<%= config.bin %> <%= command.id %> "Google"']

  public static enableJsonFlag = true

  static override flags = {
    'with-tokens': Flags.boolean({
      description: 'Include current TOTP tokens in the output',
      default: false,
    }),
  }

  static override args = {
    query: Args.string({
      description: 'Search across name and issuer',
      required: true,
    }),
  }

  public async run() {
    const { args, flags } = await this.parse(EntriesSearch)
    const { lockedRepresentationString } = await init()
    const twoFaLib = await loadVault(lockedRepresentationString)

    const withTokens = flags['with-tokens'] ? true : false

    let filteredEntries
    if (withTokens) {
      filteredEntries = twoFaLib.vault.searchEntriesMetas(args.query, true)
    } else {
      filteredEntries = twoFaLib.vault.searchEntriesMetas(args.query, false)
    }

    if (filteredEntries.length === 0) {
      this.log('No matching entries found.')
      return []
    }

    const out = generateEntriesTable(filteredEntries)
    this.log(out)
    return filteredEntries
  }
}
