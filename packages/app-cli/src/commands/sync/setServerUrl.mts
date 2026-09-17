import { Option } from 'clipanion'
import { password as passwordInput } from '@inquirer/prompts'
import type { ServerSecret } from 'favalib'
import BaseCommand from '../../BaseCommand.mjs'

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

      If --secret is not given you will be prompted for it, which keeps it out
      of your shell history.
    `,
    examples: [
      ['Set sync server URL', 'sync setServerUrl wss://sync.example.com'],
    ],
  })

  requireFavaLib = true

  serverUrl = Option.String({ required: true })
  secret = Option.String('--secret', {
    description:
      'The server secret. Prompted for when omitted, so it stays out of shell history.',
  })
  force = Option.Boolean('--force', {
    description: 'Set the sync server even if connection fails',
  })

  async exec() {
    const secret =
      this.secret ??
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
