import { input } from '@inquirer/prompts'
import BaseCommand from '../../BaseCommand.mjs'
import { TwoFaLibEvent } from 'favalib'

class ConnectCommand extends BaseCommand {
  static override paths = [['sync', 'connect']]
  requireTwoFaLib = true

  async exec() {
    if (!this.twoFaLib.sync) {
      throw new Error('No server url set')
    }

    const connectionString = await input({
      message: 'Enter connection string:',
    })

    const connectFinished = new Promise<void>((resolve) => {
      this.twoFaLib.addEventListener(
        TwoFaLibEvent.ConnectToExistingVaultFinished,
        () => {
          resolve()
        },
      )
    })

    await this.twoFaLib.sync.respondToAddDeviceFlow(connectionString, 'text')

    await connectFinished

    return { success: true }
  }
}

export default ConnectCommand
