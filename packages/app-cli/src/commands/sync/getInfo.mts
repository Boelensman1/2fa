import BaseCommand from '../../BaseCommand.mjs'

class GetInfoCommand extends BaseCommand {
  static override paths = [['sync', 'get-info']]
  requireTwoFaLib = true

  static usage = BaseCommand.Usage({
    category: 'Sync',
    description: 'Get sync info for the current device',
    details: `This command returns the friendly name and sync server URL for the current device in your vault sync configuration.`,
    examples: [['Get sync info', 'sync get-info']],
  })

  exec() {
    if (!this.twoFaLib.sync) {
      throw new Error('No server url set')
    }
    const connected = this.twoFaLib.sync.webSocketConnected || false
    const friendlyName = this.twoFaLib.meta.deviceFriendlyName || '(none)'
    const serverUrl = this.twoFaLib.sync.serverUrl || '(none)'

    this.output(`Connected: ${connected ? 'yes' : 'no'}\n`)
    this.output(`Device friendly name: ${friendlyName}\n`)
    this.output(`Sync server URL: ${serverUrl}\n`)
    return Promise.resolve({ connected, friendlyName, serverUrl })
  }
}

export default GetInfoCommand
