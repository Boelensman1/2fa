import { Command, Option } from 'clipanion'
import type { Jsonifiable } from 'type-fest'
import type { LockedRepresentationString, FavaLib } from 'favalib'

import loadVault from './utils/loadVault.mjs'
import init, { Settings } from './utils/init.mjs'

export interface ErrorInCommand {
  timestamp: number
  message: string
}

abstract class BaseCommand extends Command {
  abstract exec(): Promise<Jsonifiable>

  abstract requireFavaLib: boolean

  errors: ErrorInCommand[] = []

  preFormattedOutput = false

  json = Option.Boolean('--json', {
    description: 'output as json',
  })
  verbose = Option.Boolean('--verbose', {
    description: 'verbose output',
  })

  lockedRepresentationString!: LockedRepresentationString
  settings!: Settings
  favaLib!: FavaLib

  output(string: string) {
    if (!this.json) {
      this.context.stdout.write(string)
    }
  }

  async execute() {
    const { lockedRepresentationString, settings } = await init()

    this.settings = settings

    if (lockedRepresentationString && this.requireFavaLib) {
      this.favaLib = await loadVault(
        lockedRepresentationString,
        settings,
        this.addError.bind(this),
        this.verbose,
      )
    } else {
      if (this.requireFavaLib) {
        throw new Error('No vault loaded, was it created?')
      }
    }

    const result = await this.exec()
    if (this.favaLib?.sync) {
      this.favaLib.sync.closeServerConnection()
    }

    if (this.json) {
      // output is already formatted, don't add the result & errors bit
      if (this.preFormattedOutput) {
        this.context.stdout.write(JSON.stringify(result, null, 2) + '\n')
      } else {
        this.context.stdout.write(
          JSON.stringify({ result, errors: this.errors }, null, 2) + '\n',
        )
      }
    }

    return 0
  }

  private addError(err: Error) {
    if (this.json && !this.verbose) {
      this.errors.push({ timestamp: Date.now(), message: err.message })
    } else {
      console.error(err)
    }
  }
}

export default BaseCommand
