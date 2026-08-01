import { Command, Option } from 'clipanion'
import type { Jsonifiable } from 'type-fest'
import type { LockedRepresentationString, FavaLib } from 'favalib'

import loadVault from './utils/loadVault.mjs'
import init, { saveSettings, Settings } from './utils/init.mjs'
import { shouldConnectToSyncServer } from './utils/syncPolicy.mjs'

export interface ErrorInCommand {
  timestamp: number
  message: string
}

abstract class BaseCommand extends Command {
  abstract exec(): Promise<Jsonifiable>

  abstract requireFavaLib: boolean

  errors: ErrorInCommand[] = []

  preFormattedOutput = false

  // when true, exec()'s result is a raw string to write to stdout verbatim
  // (no JSON.stringify, no escaping/trimming) — e.g. rofi script-mode output
  rawOutput = false

  format = Option.String('--format', {
    description: 'output format (e.g. json)',
  })
  verbose = Option.Boolean('--verbose', {
    description: 'verbose output',
  })
  forceSync = Option.Boolean('--force-sync', {
    description: 'sync regardless of the configured sync interval',
  })
  noSync = Option.Boolean('--no-sync', {
    description: 'do not connect to the sync server for this command',
  })

  requiresSyncConnection = false

  lockedRepresentationString!: LockedRepresentationString
  settings!: Settings
  favaLib!: FavaLib

  // machine-readable mode: any --format suppresses human output and triggers
  // serialized output
  get machineOutput(): boolean {
    return this.format !== undefined
  }

  // the set of --format values this command accepts; subclasses extend it
  protected validFormats(): string[] {
    return ['json']
  }

  output(string: string) {
    if (!this.machineOutput) {
      this.context.stdout.write(string)
    }
  }

  async execute() {
    if (
      this.format !== undefined &&
      !this.validFormats().includes(this.format)
    ) {
      throw new Error(
        `Unknown format: ${this.format}. Valid formats: ${this.validFormats().join(', ')}`,
      )
    }

    const { lockedRepresentationString, settings } = await init()

    this.settings = settings
    this.lockedRepresentationString = lockedRepresentationString

    const connectToSyncServer = shouldConnectToSyncServer({
      forceSync: this.forceSync,
      noSync: this.noSync,
      requiresSyncConnection: this.requiresSyncConnection,
      lastSyncedAt: settings.lastSyncedAt,
      syncIntervalMs: settings.syncIntervalMinutes * 60 * 1000,
    })

    let syncRecorded = false

    if (lockedRepresentationString && this.requireFavaLib) {
      this.favaLib = await loadVault(
        lockedRepresentationString,
        settings,
        this.addError.bind(this),
        this.verbose,
        connectToSyncServer,
      )
      syncRecorded = await this.recordSuccessfulSync(connectToSyncServer)
    } else {
      if (this.requireFavaLib) {
        throw new Error('No vault loaded, was it created?')
      }
    }

    const result = await this.exec()
    if (!syncRecorded) {
      await this.recordSuccessfulSync(connectToSyncServer)
    }
    if (this.favaLib?.sync) {
      this.favaLib.sync.closeServerConnection()
    }

    if (this.machineOutput) {
      // output is already formatted, don't add the result & errors bit
      if (this.preFormattedOutput) {
        if (this.rawOutput) {
          // raw passthrough: write the formatter's string exactly as-is
          this.context.stdout.write(result)
        } else {
          this.context.stdout.write(JSON.stringify(result, null, 2) + '\n')
        }
      } else {
        this.context.stdout.write(
          JSON.stringify({ result, errors: this.errors }, null, 2) + '\n',
        )
      }
    }

    return 0
  }

  private async recordSuccessfulSync(connectToSyncServer: boolean) {
    if (!connectToSyncServer || !this.favaLib?.sync?.webSocketConnected) {
      return false
    }

    this.settings.lastSyncedAt = Date.now()
    await saveSettings(this.settings)
    return true
  }

  private addError(err: Error) {
    if (this.machineOutput && !this.verbose) {
      this.errors.push({ timestamp: Date.now(), message: err.message })
    } else {
      console.error(err)
    }
  }
}

export default BaseCommand
