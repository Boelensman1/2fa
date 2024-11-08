import { Command, Flags } from '@oclif/core'
import init from '../../init.js'
import loadVault from '../../loadVault.js'

export default class EntriesAdd extends Command {
  static override description = 'Add an entry to the vault'

  static override examples = ['<%= config.bin %> <%= command.id %>']

  static override flags = {
    name: Flags.string({
      char: 'n',
      description: 'name',
      required: true,
    }),
    secret: Flags.string({
      char: 's',
      description: 'TOTP secret',
      required: true,
    }),
    issuer: Flags.string({
      char: 'i',
      description: 'issuer of the TOTP token',
      required: true,
    }),
    digits: Flags.integer({
      char: 'd',
      description: 'number of digits in TOTP code',
      default: 6,
      required: false,
    }),
    algorithm: Flags.string({
      char: 'a',
      description: 'hash algorithm (SHA-1, SHA-256, SHA-512)',
      default: 'SHA-1',
      required: false,
      options: ['SHA-1', 'SHA-256', 'SHA-512'],
    }),
    period: Flags.integer({
      char: 'p',
      description: 'time period in seconds for TOTP code refresh',
      default: 30,
      required: false,
    }),
  }

  public async run(): Promise<void> {
    const { flags } = await this.parse(EntriesAdd)
    const { lockedRepresentationString } = await init()
    const twoFaLib = await loadVault(lockedRepresentationString)

    const { name, secret, issuer, digits, algorithm, period } = flags

    await twoFaLib.vault.addEntry({
      name,
      issuer,
      type: 'TOTP',
      payload: { secret, period, digits, algorithm },
    })
  }
}
