import { Args, Command } from '@oclif/core'
import init from '../../init.js'
import loadVault from '../../loadVault.js'
import { EntryId } from '2falib'

export default class EntriesGetToken extends Command {
  static override description = 'Get a 2FA token for a specific entry'
  public static enableJsonFlag = true

  static override examples = [
    '<%= config.bin %> <%= command.id %> "entry-id-here"',
  ]

  static override args = {
    id: Args.string({
      description: 'ID of the entry to get token for',
      required: true,
    }),
  }

  public async run() {
    const { args } = await this.parse(EntriesGetToken)
    const { lockedRepresentationString } = await init()
    const twoFaLib = await loadVault(lockedRepresentationString)

    const token = twoFaLib.vault.generateTokenForEntry(args.id as EntryId)
    this.log(token.otp)
    return token
  }
}
