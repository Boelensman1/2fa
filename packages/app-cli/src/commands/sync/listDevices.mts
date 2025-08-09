import Table from 'tty-table'

import BaseCommand from '../../BaseCommand.mjs'
import type { PublicSyncDevice } from 'favalib'

class ListDevicesCommand extends BaseCommand {
  static override paths = [['sync', 'list-devices']]
  requireFavaLib = true

  static usage = BaseCommand.Usage({
    category: 'Sync',
    description: 'List all devices synced to the vault',
    details: `This command displays all devices that are currently synced to your vault, showing their status and last sync information.`,
    examples: [['List all synced devices', 'sync list-devices']],
  })

  async exec(): Promise<{ devices: PublicSyncDevice[] }> {
    if (!this.favaLib.sync) {
      throw new Error('No server url set')
    }

    const devices = this.favaLib.sync.getSyncDevices()

    const headers = [
      { value: 'deviceId', align: 'left', width: 38 },
      { value: 'deviceType', align: 'left', width: 38 },
      { value: 'deviceFriendlyName', align: 'left', width: 38 },
    ]

    const tableOptions = {
      borderStyle: 'solid',
      paddingLeft: 1,
      paddingRight: 1,
      headerAlign: 'left',
    }
    this.output(Table(headers, devices, [], tableOptions).render() + '\n')

    return Promise.resolve({ devices })
  }
}

export default ListDevicesCommand
