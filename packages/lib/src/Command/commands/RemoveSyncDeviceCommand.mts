import { InvalidCommandError, FavaLibError } from '../../FavaLibError.mjs'
import type FavaLibMediator from '../../FavaLibMediator.mjs'
import Command from '../BaseCommand.mjs'
import type { DeviceId } from '../../interfaces/SyncTypes.mjs'

export interface RemoveSyncDeviceData {
  deviceId: DeviceId
}

/**
 * Represents a command that when executed removes a sync device from the vault.
 */
class RemoveSyncDeviceCommand extends Command<RemoveSyncDeviceData> {
  /**
   * Creates a new RemoveSyncDeviceCommand instance.
   * @inheritdoc
   * @param data - The id of the device to be removed.
   */
  constructor(
    data: RemoveSyncDeviceData,
    id?: string,
    timestamp?: number,
    version?: string,
    fromRemote = false,
  ) {
    super('RemoveSyncDevice', data, id, timestamp, version, fromRemote)
  }

  /**
   * Executes the command to remove a sync device
   * @inheritdoc
   * @throws {InvalidCommandError} If the command data is invalid.
   */
  async execute(mediator: FavaLibMediator) {
    if (!this.validate()) {
      throw new InvalidCommandError('Invalid RemoveSyncDevice command')
    }
    const syncManager = mediator.getComponent('syncManager')
    await syncManager.removeSyncDevice(this.data.deviceId)
  }

  /**
   * @inheritdoc
   */
  createUndoCommand(): Command {
    throw new FavaLibError('Not implemented yet')
  }

  /**
   * Validates the command data.
   * @returns True if the command data is valid, false otherwise.
   */
  validate(): boolean {
    return this.data.deviceId !== undefined
  }
}

export default RemoveSyncDeviceCommand
