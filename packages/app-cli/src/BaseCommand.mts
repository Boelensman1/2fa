import { Command, Option } from 'clipanion'
import type { Jsonifiable } from 'type-fest'
import type {
  LockedRepresentationString,
  FavaLib,
  LoadFavaLibOptions,
} from 'favalib'

import loadVault from './utils/loadVault.mjs'
import CliError from './CliError.mjs'
import init, { saveSettings, Settings } from './utils/init.mjs'
import { shouldConnectToSyncServer } from './utils/syncPolicy.mjs'
import { readSyncServerConfig } from './utils/syncConfig.mjs'

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

  protected exitCode = 0

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

  // when true the command can do nothing at all without a live, authenticated
  // server connection -- pairing and resilvering both reach the other device
  // through the server -- so execute() refuses with a diagnosis before exec()
  // runs. Without this, such a command would go on to prompt for a connection
  // string and then fail on the first message it tried to send.
  requiresLiveSyncConnection = false

  // when false, execute() skips init() altogether: nothing reads the settings
  // file, nothing writes one, and no vault is touched. For a command that only
  // reports on the binary itself that is the point -- it is asked for when the
  // settings or the vault are the thing that is broken.
  requiresSettings = true

  // when true the command writes to the vault, so it connects regardless of
  // the sync interval and waits for the server to take its commands
  mutatesVault = false

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

  protected async vaultLoadOptions(
    connectToSyncServer: boolean,
  ): Promise<LoadFavaLibOptions> {
    return { connectToSyncServer, syncServer: await readSyncServerConfig() }
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

    if (!this.requiresSettings) {
      this.writeResult(await this.exec())
      return this.exitCode
    }

    const { lockedRepresentationString, settings } = await init()

    this.settings = settings
    this.lockedRepresentationString = lockedRepresentationString

    const connectToSyncServer = shouldConnectToSyncServer({
      forceSync: this.forceSync,
      noSync: this.noSync,
      requiresSyncConnection:
        this.requiresSyncConnection || this.requiresLiveSyncConnection,
      mutatesVault: this.mutatesVault,
      lastSyncedAt: settings.lastSyncedAt,
      syncIntervalMs: settings.syncIntervalMinutes * 60 * 1000,
    })

    let syncRecorded = false

    try {
      if (lockedRepresentationString && this.requireFavaLib) {
        this.favaLib = await loadVault(
          lockedRepresentationString,
          settings,
          this.reportLibLog.bind(this),
          await this.vaultLoadOptions(connectToSyncServer),
        )
        syncRecorded = await this.recordSuccessfulSync(connectToSyncServer)
        await this.assertLiveSyncConnection()
      } else {
        if (this.requireFavaLib) {
          throw new Error('No vault loaded, was it created?')
        }
      }

      const result = await this.exec()
      await this.flushSync(connectToSyncServer)
      if (!syncRecorded) {
        await this.recordSuccessfulSync(connectToSyncServer)
      }
      this.writeResult(result)

      return this.exitCode
    } finally {
      this.favaLib?.sync?.closeServerConnection()
    }
  }

  /**
   * Refuses a command that needs the sync server when the server is not there.
   *
   * The vault has loaded by now and `favaLib.ready` has settled, so the
   * connection is as connected as it is going to get: waiting longer would only
   * move the failure to the first message the command sends -- or, for one that
   * prompts first, to after the user has typed a connection string that was
   * never going anywhere.
   * @throws {CliError} If there is no usable connection.
   */
  private async assertLiveSyncConnection() {
    if (!this.requiresLiveSyncConnection) {
      return
    }

    const sync = this.favaLib.sync
    if (!sync) {
      throw new CliError(
        'This command needs a sync server, and this vault is not configured ' +
          'with one. Run "favacli sync setServerUrl <url>" first.',
      )
    }

    if (sync.webSocketConnected) {
      return
    }

    throw new CliError(
      `${await sync.diagnoseConnectionFailure()}. This command needs a live ` +
        'connection, so it has not run.',
      'SyncConnectionError',
    )
  }

  private writeResult(result: Jsonifiable) {
    if (!this.machineOutput) {
      return
    }

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

  /**
   * Waits for the server to take whatever exec() queued, before the process
   * exits and takes the queue with it.
   * @param connectToSyncServer - Whether this command connected to the server.
   */
  private async flushSync(connectToSyncServer: boolean) {
    const sync = this.favaLib?.sync
    if (!sync || !connectToSyncServer) {
      // nothing was meant to leave this process, so nothing to wait for
      return
    }

    if (await sync.flushCommandSendQueue()) {
      return
    }

    this.report(
      'Changes could not be sent to the sync server. They are stored in the ' +
        'vault and will be sent the next time this device connects.',
    )
  }

  /**
   * Writes one line for the user, or records it for machine output.
   *
   * Deliberately not `console.error`, and deliberately not an `Error`: in
   * machine mode the process has exactly one JSON document to produce and
   * stderr chatter is not part of it, and in interactive mode a line is a line.
   * Printing one as an `Error` object put a stack trace under an ordinary sync
   * notice, pointing at the listener that constructed it rather than at
   * anything that had failed.
   * @param message - The line to write.
   */
  private report(message: string) {
    if (this.machineOutput) {
      this.errors.push({ timestamp: Date.now(), message })
    } else {
      this.context.stderr.write(`${message}\n`)
    }
  }

  /**
   * Surfaces one favalib log event, at the weight favalib gave it.
   *
   * The three severities mean different things -- see `Events.mts` -- and this
   * command is the consumer that has to decide what each is worth here.
   * @param severity - What favalib called it.
   * @param message - The message.
   */
  private reportLibLog(
    severity: 'info' | 'warning' | 'error',
    message: string,
  ) {
    switch (severity) {
      // favalib's word for a refusal the user should hear about even though the
      // library carried on. Prefixed so it is not read as the ordinary noise of
      // a sync connection -- which is what 'warning' is, and why that one gets
      // no prefix.
      case 'error':
        this.report(`Error: ${message}`)
        break
      case 'warning':
        this.report(message)
        break
      default:
        // Diagnostics, so only on request. Through `output` rather than a bare
        // write because `output` is already a no-op under --format, which is
        // what keeps an info line out of the middle of the JSON document.
        if (this.verbose) {
          this.output(`${message}\n`)
        }
    }
  }

  private async recordSuccessfulSync(connectToSyncServer: boolean) {
    if (!connectToSyncServer || !this.favaLib?.sync?.webSocketConnected) {
      return false
    }

    this.settings.lastSyncedAt = Date.now()
    await saveSettings(this.settings)
    return true
  }
}

export default BaseCommand
