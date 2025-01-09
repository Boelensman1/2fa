import { Option } from 'clipanion'
import BaseCommand from '../../BaseCommand.mjs'

class SetServerUrlCommand extends BaseCommand {
  static override paths = [['sync', 'setServerUrl']]

  static usage = BaseCommand.Usage({
    category: 'Sync',
    description: 'Set the server URL for syncing',
    details: `
      This command sets the URL of the server that will be used for syncing.

      The server URL must be provided as an argument.
    `,
    examples: [
      ['Set sync server URL', 'sync setServerUrl https://example.com'],
    ],
  })

  requireTwoFaLib = true

  serverUrl = Option.String({ required: true })
  force = Option.Boolean('--force', {
    description: 'Set serverUrl even if connection fails',
  })

  async exec() {
    await this.twoFaLib.setSyncServerUrl(this.serverUrl, this.force)
    return { success: true }
  }
}

export default SetServerUrlCommand
