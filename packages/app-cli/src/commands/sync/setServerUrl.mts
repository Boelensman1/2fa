import { Option } from 'clipanion'
import { password as passwordInput } from '@inquirer/prompts'
import type { ServerSecret } from 'favalib'
import BaseCommand from '../../BaseCommand.mjs'
import { readServerSecret } from '../../utils/syncConfig.mjs'

class SetServerUrlCommand extends BaseCommand {
  static override paths = [['sync', 'setServerUrl']]
  override requiresSyncConnection = true

  static usage = BaseCommand.Usage({
    category: 'Sync',
    description: 'Set the server URL and shared secret for syncing',
    details: `
      This command sets the URL of the server that will be used for syncing,
      together with the secret that server is configured with.

      Both are needed: a sync server refuses a connection that cannot prove the
      secret, so a URL on its own configures nothing. The secret is stored in
      your vault and is never sent to the server - what travels is an HMAC over
      a challenge the server issues.

      Supply --secret-file to read the secret from a file. Without an explicit
      --secret or --secret-file, FAVACLI_SYNC_SERVER_SECRET or
      FAVACLI_SYNC_SERVER_SECRET_FILE is used; otherwise you will be prompted.

      For automatic configuration on every vault load, set
      FAVACLI_SYNC_SERVER_URL together with either secret environment variable.
      This command explicitly stores its URL and secret in the vault; later
      commands still prefer the environment settings when present.
    `,
    examples: [
      ['Set sync server URL', 'sync setServerUrl wss://sync.example.com'],
      [
        'Read the secret from a file',
        'sync setServerUrl wss://sync.example.com --secret-file /run/secrets/fava-sync',
      ],
    ],
  })

  requireFavaLib = true

  serverUrl = Option.String({ required: true })
  secret = Option.String('--secret', {
    description: 'The server secret. Prefer --secret-file or the prompt.',
  })
  secretFile = Option.String('--secret-file', {
    description:
      'Read the server secret from this file (one trailing newline is removed).',
  })
  force = Option.Boolean('--force', {
    description: 'Set the sync server even if connection fails',
  })

  protected override vaultLoadOptions() {
    // This command supplies its own connection settings. Do not connect to the
    // old server or apply environment overrides before setting the new ones.
    return Promise.resolve({ connectToSyncServer: false })
  }

  async exec() {
    const secret =
      (await readServerSecret({
        secret: this.secret,
        secretFile: this.secretFile,
      })) ??
      (await passwordInput({
        message: 'Enter the sync server secret:',
        mask: true,
      }))

    if (!secret) {
      throw new Error('A server secret is required')
    }

    await this.favaLib.setSyncServerUrl(
      this.serverUrl,
      secret as ServerSecret,
      this.force,
    )
    return { success: true }
  }
}

export default SetServerUrlCommand
