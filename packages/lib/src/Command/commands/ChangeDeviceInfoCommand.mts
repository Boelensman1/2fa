import { InvalidCommandError, TwoFALibError } from '../../TwoFALibError.mjs'
import type TwoFaLibMediator from '../../TwoFaLibMediator.mjs'
import Command from '../BaseCommand.mjs'
import type {
  DeviceFriendlyName,
  DeviceId,
  DeviceType,
} from '../../interfaces/SyncTypes.mjs'

export interface ChangeDeviceInfoData {
  deviceId: DeviceId
  newDeviceInfo: {
    deviceFriendlyName?: DeviceFriendlyName
    deviceType: DeviceType
  }
}

/**
 * Represents a command that when executed changes the device info of a sync device
 */
class ChangeDeviceInfoCommand extends Command<ChangeDeviceInfoData> {
  /**
   * Creates a new ChangeDeviceMetaCommand instance.
   * @inheritdoc
   * @param data - The id of the device to change and the new meta info
   */
  constructor(
    data: ChangeDeviceInfoData,
    id?: string,
    timestamp?: number,
    version?: string,
    fromRemote = false,
  ) {
    super('ChangeDeviceInfo', data, id, timestamp, version, fromRemote)
  }

  /**
   * Executes the command to change the device info
   * @inheritdoc
   * @throws {InvalidCommandError} If the referenced device cannot be found
   */
  async execute(mediator: TwoFaLibMediator) {
    if (!this.validate(mediator)) {
      throw new InvalidCommandError(
        'Failed to validate ChangeDeviceInfo command',
      )
    }

    const lib = mediator.getComponent('lib')
    if (this.data.deviceId === lib.meta.deviceId) {
      // we're changing our own friendly name
      // eslint-disable-next-line @typescript-eslint/dot-notation
      lib['favaMeta'].deviceFriendlyName =
        this.data.newDeviceInfo.deviceFriendlyName
    }

    const syncManager = mediator.getComponent('syncManager')
    if (syncManager) {
      // eslint-disable-next-line @typescript-eslint/dot-notation
      const device = syncManager['syncDevices'].find(
        (d) => d.deviceId === this.data.deviceId,
      )
      if (!device) {
        throw new InvalidCommandError(
          'Trying to change info of device that is not found',
        )
      }
      device.deviceInfo = this.data.newDeviceInfo
    }

    await mediator.getComponent('persistentStorageManager').save()
  }

  /**
   * @inheritdoc
   */
  createUndoCommand(): Command {
    throw new TwoFALibError('Not implemented yet')
  }

  /**
   * Validates the command data.
   * @inheritdoc
   */
  validate(mediator: TwoFaLibMediator): boolean {
    const lib = mediator.getComponent('lib')
    if (this.fromRemote) {
      // we can only validate this command locally
      return true
    }
    if (this.data.deviceId !== lib.meta.deviceId) {
      // device ids are not identical
      return false
    }
    if (this.data.newDeviceInfo.deviceType !== lib.meta.deviceType) {
      // Changing device type
      return false
    }

    const deviceFriendlyName = this.data.newDeviceInfo.deviceFriendlyName
    if (deviceFriendlyName !== undefined) {
      if (deviceFriendlyName.length > 256) {
        return false
      }
      if (deviceFriendlyName.length < 1) {
        return false
      }
    }

    return true
  }
}

export default ChangeDeviceInfoCommand
