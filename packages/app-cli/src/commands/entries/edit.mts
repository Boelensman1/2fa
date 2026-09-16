import { Option, UsageError } from 'clipanion'
import { URL_MATCHER_TYPES, parseMatcherSpec } from 'favalib'
import type { EntryId, UrlMatcher } from 'favalib'

import BaseCommand from '../../BaseCommand.mjs'

class EntriesEditCommand extends BaseCommand {
  static override paths = [['entries', 'edit']]

  static usage = BaseCommand.Usage({
    category: 'Entries',
    description: 'Change an existing TOTP entry',
    details: `
      This command edits the non-secret fields of an entry. The secret itself
      cannot be changed; delete the entry and add it again instead.

      --match replaces the entry's whole matcher list, so pass every matcher
      the entry should end up with. Pass --clear-matchers to remove them all.
    `,
    examples: [
      [
        'Point an entry at a site',
        'entries edit <id> --url https://github.com/login --match BaseDomain:github.com',
      ],
      [
        'Give an entry two matchers',
        'entries edit <id> --match BaseDomain:google.com --match BaseDomain:youtube.com',
      ],
      [
        'Remove every matcher from an entry',
        'entries edit <id> --clear-matchers',
      ],
    ],
  })

  requireFavaLib = true
  override mutatesVault = true

  id = Option.String({ required: true })

  name = Option.String('--name', { description: 'A new name for the entry' })
  issuer = Option.String('--issuer', {
    description: 'A new issuer for the entry',
  })
  url = Option.String('--url', {
    description: 'The canonical login url for this entry',
  })
  inputSelector = Option.String('--input-selector', {
    description: "A css selector for the site's one-time-code input",
  })
  match = Option.Array('--match', {
    description: `A site matcher, as TYPE:VALUE. TYPE is one of ${URL_MATCHER_TYPES.join(', ')}. May be repeated, and replaces the existing matchers.`,
  })
  clearMatchers = Option.Boolean('--clear-matchers', {
    description: 'Remove every matcher from the entry',
  })

  async exec() {
    if (this.match && this.clearMatchers) {
      throw new UsageError('--match and --clear-matchers cannot be combined')
    }

    const updates: Parameters<typeof this.favaLib.vault.updateEntry>[1] = {}

    if (this.name !== undefined) {
      updates.name = this.name
    }
    if (this.issuer !== undefined) {
      updates.issuer = this.issuer
    }
    if (this.url !== undefined) {
      updates.url = this.url === '' ? null : this.url
    }
    if (this.inputSelector !== undefined) {
      updates.inputSelector =
        this.inputSelector === '' ? null : this.inputSelector
    }
    if (this.clearMatchers) {
      updates.matchers = []
    }
    if (this.match) {
      updates.matchers = this.match.map((spec): UrlMatcher => {
        const matcher = parseMatcherSpec(spec)
        if (!matcher) {
          throw new UsageError(
            `Invalid --match "${spec}". Expected TYPE:VALUE, where TYPE is one of ${URL_MATCHER_TYPES.join(', ')}.`,
          )
        }
        return matcher
      })
    }

    if (Object.keys(updates).length === 0) {
      throw new UsageError('Nothing to change, pass at least one option')
    }

    await this.favaLib.vault.updateEntry(this.id as EntryId, updates)
    this.output('Entry updated!')
    return { success: true }
  }
}

export default EntriesEditCommand
