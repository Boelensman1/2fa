import BaseCommand from '../../BaseCommand.mjs'

class ResilverCommand extends BaseCommand {
  static override paths = [['sync', 'resilver']]
  requireTwoFaLib = true

  static usage = BaseCommand.Usage({
    category: 'Sync',
    description: 'Resilver a vault',
    details: `This command allows you to resync a vault to the server. This is useful if some devices have become desynced.`,
    examples: [['Resilver a vault', 'sync resilver']],
  })

  async exec() {
    if (!this.twoFaLib.sync) {
      throw new Error('No server url set')
    }

    await this.twoFaLib.sync.requestResilver()

    // TODO: do this based on events
    await new Promise((resolve) => setTimeout(resolve, 5000))

    return { success: true }
  }
}

export default ResilverCommand
