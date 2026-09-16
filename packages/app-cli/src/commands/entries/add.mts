import { Option, UsageError } from 'clipanion'
import { URL_MATCHER_TYPES, parseMatcherSpec } from 'favalib'
import type { UrlMatcher } from 'favalib'

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
      [
        'Add a TOTP entry the browser extension can match to a site',
        'entries add --name "My Account" --issuer "GitHub" --secret JBSWY3DPEHPK3PXP --url https://github.com/login --match BaseDomain:github.com',
      ],
      [
        'Add a TOTP entry matching several sites',
        'entries add --name "My Account" --issuer "Google" --secret JBSWY3DPEHPK3PXP --match BaseDomain:google.com --match BaseDomain:youtube.com',
      ],
    ],
  })

  requireFavaLib = true
  override mutatesVault = true

  name = Option.String('--name', { required: true })
  issuer = Option.String('--issuer', { required: true })
  secret = Option.String('--secret', { required: true })
  period = Option.String('--period', '30')
  digits = Option.String('--digits', '6')
  algorithm = Option.String('--algorithm', 'SHA-1')
  url = Option.String('--url', {
    description: 'The canonical login url for this entry',
  })
  inputSelector = Option.String('--input-selector', {
    description: "A css selector for the site's one-time-code input",
  })
  match = Option.Array('--match', {
    description: `A site matcher, as TYPE:VALUE. TYPE is one of ${URL_MATCHER_TYPES.join(', ')}. May be repeated.`,
  })

  async exec() {
    const matchers: UrlMatcher[] = (this.match ?? []).map((spec) => {
      const matcher = parseMatcherSpec(spec)
      if (!matcher) {
        throw new UsageError(
          `Invalid --match "${spec}". Expected TYPE:VALUE, where TYPE is one of ${URL_MATCHER_TYPES.join(', ')}.`,
        )
      }
      return matcher
    })

    await this.favaLib.vault.addEntry({
      name: this.name,
      issuer: this.issuer,
      type: 'TOTP',
      matchers,
      url: this.url ?? null,
      inputSelector: this.inputSelector ?? null,
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
