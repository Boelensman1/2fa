import BaseCommand from '../../BaseCommand.mjs'

class StatusCommand extends BaseCommand {
  static override paths = [['sync', 'status']]
  override requiresSyncConnection = true
  requireFavaLib = true

  static usage = BaseCommand.Usage({
    category: 'Sync',
    description: 'Show sync status for the current device',
    details: `This command returns the friendly name and sync server URL for the current device in your vault sync configuration.`,
    examples: [['Show sync status', 'sync status']],
  })

  exec() {
    if (!this.favaLib.sync) {
      throw new Error('No server url set')
    }
    const connected = this.favaLib.sync.webSocketConnected || false
    const friendlyName = this.favaLib.meta.deviceFriendlyName || '(none)'
    const serverUrl = this.favaLib.sync.serverUrl || '(none)'
    // Whether, never what. A secret that is printed on request is a secret that
    // ends up in a terminal scrollback, a screenshot or a support ticket.
    const serverSecretSet = Boolean(this.favaLib.sync.serverSecret)

    this.output(`Connected: ${connected ? 'yes' : 'no'}\n`)
    this.output(`Device friendly name: ${friendlyName}\n`)
    this.output(`Sync server URL: ${serverUrl}\n`)
    this.output(`Sync server secret: ${serverSecretSet ? 'set' : '(none)'}\n`)
    return Promise.resolve({
      connected,
      friendlyName,
      serverUrl,
      serverSecretSet,
    })
  }
}

export default StatusCommand
