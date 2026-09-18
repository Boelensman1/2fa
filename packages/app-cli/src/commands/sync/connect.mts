import { input } from '@inquirer/prompts'
import BaseCommand from '../../BaseCommand.mjs'
import { deviceLabel, FavaLibEvent } from 'favalib'
import type { DeviceFriendlyName } from 'favalib'

class ConnectCommand extends BaseCommand {
  static override paths = [['sync', 'connect']]
  requireFavaLib = true
  override requiresSyncConnection = true
  override requiresLiveSyncConnection = true

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
    if (!this.favaLib.sync) {
      throw new Error('No server url set')
    }

    const connectionString = await input({
      message: 'Enter connection string:',
    })

    const friendlyName = (
      await input({
        message: 'Enter a friendly name for this device (optional):',
      })
    ).trim()

    if (friendlyName) {
      await this.favaLib.setDeviceFriendlyName(
        friendlyName as DeviceFriendlyName,
      )
    }

    const connectFinished = new Promise<void>((resolve) => {
      this.favaLib.addEventListener(
        FavaLibEvent.ConnectToExistingVaultFinished,
        () => {
          resolve()
        },
      )
    })

    await this.favaLib.sync.respondToAddDeviceFlow(connectionString, 'text')

    await connectFinished

    // The device list that arrived with the vault is not announced device by
    // device -- the user chose to join this vault, so its contents are the
    // baseline rather than news (see `addSyncDevice`'s `announce`). It is still
    // worth seeing once, here, where it is a list to read rather than N
    // warnings to dismiss. Fingerprints included: they are what a device is
    // actually verified by, and what `sync remove-device` is aimed with.
    const devices = this.favaLib.sync.getSyncDevices()
    this.output(
      `Paired. This vault has ${String(devices.length)} other device(s):\n` +
        devices
          .map((device) => `  ${deviceLabel(device)}  ${device.fingerprint}\n`)
          .join(''),
    )

    return { success: true }
  }
}

export default ConnectCommand
