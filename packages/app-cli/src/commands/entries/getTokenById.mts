import { Option } from 'clipanion'
import { EntryNotFoundError } from 'favalib'
import type { EntryId } from 'favalib'

import BaseCommand from '../../BaseCommand.mjs'

class EntriesGetTokenByIdCommand extends BaseCommand {
  static override paths = [['entries', 'get-token-by-id']]

  static usage = BaseCommand.Usage({
    category: 'Entries',
    description: 'Get the current TOTP token for an entry by its id',
    details: `
      This command generates and prints the current TOTP code for a single
      entry, identified by its id.
    `,
    examples: [
      ['Get the current token for an entry', 'entries get-token-by-id <id>'],
    ],
  })

  requireFavaLib = true

  id = Option.String({ required: true })

  async exec() {
    const id = this.id as EntryId
    try {
      const token = await this.favaLib.vault.generateTokenForEntry(id)
      this.output(`${token.otp}\n`)
      return token.otp
    } catch (err) {
      if (err instanceof EntryNotFoundError) {
        this.output(`No entry found with id ${this.id}\n`)
        this.errors.push({ timestamp: Date.now(), message: err.message })
        return null
      }
      throw err
    }
  }
}

export default EntriesGetTokenByIdCommand
