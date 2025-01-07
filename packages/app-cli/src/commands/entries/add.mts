import { Option } from 'clipanion'

import BaseCommand from '../../BaseCommand.mjs'

class EntriesAddCommand extends BaseCommand {
  static override paths = [['entries', 'add']]

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
