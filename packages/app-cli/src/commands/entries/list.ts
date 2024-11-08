import { Command } from '@oclif/core'
import init from '../../init.js'
import loadVault from '../../loadVault.js'
import generateEntriesTable from '../../generateEntriesTable.js'

export default class EntriesList extends Command {
  static override description = 'Add an entry to the vault'

  static override examples = ['<%= config.bin %> <%= command.id %>']

  public static enableJsonFlag = true

  public async run() {
    const { lockedRepresentationString } = await init()
    const twoFaLib = await loadVault(lockedRepresentationString)

    const entries = twoFaLib.vault.listEntriesMetas()

    if (entries.length === 0) {
      this.log('No entries.')
      return []
    }

    this.log(generateEntriesTable(entries))
    return entries
  }
}
