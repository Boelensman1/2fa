import { Option } from 'clipanion'

import BaseCommand from '../../BaseCommand.mjs'

class EntriesAddCommand extends BaseCommand {
  static override paths = [['entries', 'add']]

  static usage = BaseCommand.Usage({
    category: 'Entries',
    description: 'Add a new TOTP entry to the vault',
    details: `
      This command adds a new time-based one-time password (TOTP) entry to your vault.

      The secret must be provided in base32 format.
    `,
    examples: [
      [
        'Add a basic TOTP entry',
        'entries add --name "My Account" --issuer "Example.com" --secret JBSWY3DPEHPK3PXP',
      ],
      [
        'Add a TOTP entry with custom period and digits',
        'entries add --name "Custom Account" --issuer "Example.com" --secret AAAAAAAA --period 60 --digits 8',
      ],
    ],
  })

  requireTwoFaLib = true

  name = Option.String('--name', { required: true })
  issuer = Option.String('--issuer', { required: true })
  secret = Option.String('--secret', { required: true })
  period = Option.String('--period', '30')
  digits = Option.String('--digits', '6')
  algorithm = Option.String('--algorithm', 'SHA-1')

  async exec() {
    await this.twoFaLib.vault.addEntry({
      name: this.name,
      issuer: this.issuer,
      type: 'TOTP',
      payload: {
        secret: this.secret,
        period: Number.parseInt(this.period, 10),
        digits: Number.parseInt(this.digits, 10),
        algorithm: this.algorithm,
      },
    })
    this.output('Entry added!')
    return { success: true }
  }
}

export default EntriesAddCommand
