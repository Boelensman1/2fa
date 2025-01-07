import { Command, Option } from 'clipanion'
import type { Jsonifiable } from 'type-fest'
import type { LockedRepresentationString, TwoFaLib } from 'favalib'

import loadVault from './utils/loadVault.mjs'
import init, { Settings } from './utils/init.mjs'

abstract class BaseCommand extends Command {
  abstract exec(): Promise<Jsonifiable>

  abstract requireTwoFaLib: boolean

  json = Option.Boolean('--json', {
    description: 'output as json',
  })
  verbose = Option.Boolean('--verbose', {
    description: 'verbose output',
  })

  lockedRepresentationString!: LockedRepresentationString
  settings!: Settings
  twoFaLib!: TwoFaLib

  output(string: string) {
    if (!this.json) {
      this.context.stdout.write(string)
    }
  }

  async execute() {
    const { lockedRepresentationString, settings } = await init()

    this.settings = settings

    if (lockedRepresentationString) {
      this.twoFaLib = await loadVault(lockedRepresentationString, this.verbose)
    } else {
      if (this.requireTwoFaLib) {
        throw new Error('TwoFaLib is required')
      }
    }

    const json = await this.exec()
    if (this.json) {
      this.context.stdout.write(JSON.stringify(json, null, 2) + '\n')
    }

    if (this.twoFaLib?.sync) {
      this.twoFaLib.sync.closeServerConnection()
    }

    return 0
  }
}

export default BaseCommand
