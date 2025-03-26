import { InvalidCommandError, TwoFALibError } from '../../TwoFALibError.mjs'
import type TwoFaLibMediator from '../../TwoFaLibMediator.mjs'
import Command from '../BaseCommand.mjs'
import type {
  DeviceFriendlyName,
  DeviceId,
  DeviceType,
} from '../../interfaces/SyncTypes.mjs'

export interface ChangeSyncDeviceMetaData {
  deviceId: DeviceId
  newMeta: { deviceFriendlyName: DeviceFriendlyName; deviceType: DeviceType }
}

/**
 * Represents a command that when executed changes the meta info of a sync device
 */
class ChangeSyncDeviceMetaCommand extends Command<ChangeSyncDeviceMetaData> {
  /**
   * Creates a new ChangeSyncDeviceMetaCommand instance.
   * @inheritdoc
   * @param data - The id of the device to change and the new meta info
   */
  constructor(
    data: ChangeSyncDeviceMetaData,
    id?: string,
    timestamp?: number,
    version?: string,
    fromRemote = false,
  ) {
    super('ChangeSyncDeviceMeta', data, id, timestamp, version, fromRemote)
  }

  /**
   * Executes the command to change the sync device metadata
   * @inheritdoc
   * @throws {InvalidCommandError} If the referenced sync device cannot be found
   */
  execute(mediator: TwoFaLibMediator) {
    const syncManager = mediator.getComponent('syncManager')

    // eslint-disable-next-line @typescript-eslint/dot-notation
    const device = syncManager['syncDevices'].find(
      (d) => d.deviceId === this.data.deviceId,
    )
    if (!device) {
      throw new InvalidCommandError(
        'Trying to change meta of device that is not found',
      )
    }
    device.meta = this.data.newMeta
    return Promise.resolve()
  }

  /**
   * @inheritdoc
   */
  createUndoCommand(): Command {
    throw new TwoFALibError('Not implemented yet')
  }
}

export default ChangeSyncDeviceMetaCommand
