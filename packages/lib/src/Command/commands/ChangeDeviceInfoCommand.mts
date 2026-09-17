import { InvalidCommandError, FavaLibError } from '../../FavaLibError.mjs'
import type FavaLibMediator from '../../FavaLibMediator.mjs'
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
    fromDeviceId?: DeviceId,
  ) {
    super(
      'ChangeDeviceInfo',
      data,
      id,
      timestamp,
      version,
      fromRemote,
      fromDeviceId,
    )
  }

  /**
   * Executes the command to change the device info
   * @inheritdoc
   * @throws {InvalidCommandError} If the referenced device cannot be found
   */
  async execute(mediator: FavaLibMediator) {
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
    throw new FavaLibError('Not implemented yet')
  }

  /**
   * Validates the command data.
   *
   * A remote rename used to return true unconditionally -- "we can only
   * validate this command locally" -- which made this the one ingest path with
   * no bound at all: any peer could set any device's friendly name to anything
   * of any length. Two things follow from that, and both are checked here now.
   *
   * **A peer may rename only itself.** `fromDeviceId` is the device whose
   * signature SyncManager verified, so requiring it to equal the device being
   * renamed is a real check rather than a comparison of two attacker-chosen
   * strings. It matters more than it looks: the friendly name is what a user
   * reads when deciding whether a device belongs, and a peer able to write
   * anyone's name can dress its own device as the user's phone. That is why
   * `getSyncDevices` reports a key fingerprint too -- a name is chosen, a
   * fingerprint is derived.
   *
   * **The length bounds apply to both paths**, since a remote name lands in
   * the same vault as a local one.
   * @inheritdoc
   */
  validate(mediator: FavaLibMediator): boolean {
    const lib = mediator.getComponent('lib')

    const deviceFriendlyName = this.data.newDeviceInfo.deviceFriendlyName
    if (deviceFriendlyName !== undefined) {
      if (deviceFriendlyName.length > 256) {
        return false
      }
      if (deviceFriendlyName.length < 1) {
        return false
      }
    }
    if (
      this.data.newDeviceInfo.deviceType.length < 1 ||
      this.data.newDeviceInfo.deviceType.length > 256
    ) {
      return false
    }

    if (this.fromRemote) {
      // A peer renames itself or nothing. deviceType is not compared against
      // anything: only the sending device knows what it runs on, and it is the
      // sending device saying so.
      return (
        this.fromDeviceId !== undefined &&
        this.data.deviceId === this.fromDeviceId
      )
    }

    if (this.data.deviceId !== lib.meta.deviceId) {
      // device ids are not identical
      return false
    }
    if (this.data.newDeviceInfo.deviceType !== lib.meta.deviceType) {
      // Changing device type
      return false
    }

    return true
  }
}

export default ChangeDeviceInfoCommand
