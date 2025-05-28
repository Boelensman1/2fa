import { Option } from 'clipanion'
import type { DeviceFriendlyName } from 'favalib'

import BaseCommand from '../../BaseCommand.mjs'

class SetFriendlyNameCommand extends BaseCommand {
  static override paths = [['sync', 'set-friendly-name']]
  requireTwoFaLib = true

  static usage = BaseCommand.Usage({
    category: 'Sync',
    description: 'Set friendly name for the current device',
    details: `This command allows you to set the friendly name for the current device in your vault sync configuration.`,
    examples: [
      ['Set device name', 'sync set-friendly-name --name "My Laptop"'],
      ['Set device name', 'sync set-friendly-name --name "Work Phone"'],
    ],
  })

  name = Option.String('--name', { required: true })

  async exec() {
    if (!this.twoFaLib.sync) {
      throw new Error('No server url set')
    }

    await this.twoFaLib.setDeviceFriendlyName(this.name as DeviceFriendlyName)

    this.output(`Device name set to: ${this.name}\n`)

    return { success: true }
  }
}

export default SetFriendlyNameCommand
