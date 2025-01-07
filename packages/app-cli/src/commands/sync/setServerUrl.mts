import { Option } from 'clipanion'
import BaseCommand from '../../BaseCommand.mjs'

class SetServerUrlCommand extends BaseCommand {
  static override paths = [['sync', 'setServerUrl']]

  requireTwoFaLib = true

  serverUrl = Option.String({ required: true })

  async exec() {
    await this.twoFaLib.setSyncServerUrl(this.serverUrl)
    return { success: true }
  }
}

export default SetServerUrlCommand
