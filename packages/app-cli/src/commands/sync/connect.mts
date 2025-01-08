import { input } from '@inquirer/prompts'
import BaseCommand from '../../BaseCommand.mjs'
import { TwoFaLibEvent } from 'favalib'

class ConnectCommand extends BaseCommand {
  static override paths = [['sync', 'connect']]
  requireTwoFaLib = true

  static usage = BaseCommand.Usage({
    category: 'Sync',
    description: 'Connect to an existing vault using a connection string',
    details: `
      This command allows you to connect to an existing vault by providing a connection string.
      
      The connection string should be obtained from the device that hosts the vault you want to connect to.
    `,
    examples: [['Connect to an existing vault', 'sync connect']],
  })

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
