import { InvalidCommandError, FavaLibError } from '../../FavaLibError.mjs'
import type FavaLibMediator from '../../FavaLibMediator.mjs'
import Command from '../BaseCommand.mjs'
import type { DeviceId, DeviceInfo } from '../../interfaces/SyncTypes.mjs'
import type { PublicKey } from '../../interfaces/CryptoLib.mjs'

export interface AddSyncDeviceData {
  deviceId: DeviceId
  publicKey: PublicKey
  deviceInfo: DeviceInfo
}

/**
 * Represents a command that when executed add an entry to the vault.
 */
class AddSyncDeviceCommand extends Command<AddSyncDeviceData> {
  /**
   * Creates a new AddSyncDeviceCommand instance.
   * @inheritdoc
   * @param data - The data of the entry to be added.
   */
  constructor(
    data: AddSyncDeviceData,
    id?: string,
    timestamp?: number,
    version?: string,
    fromRemote = false,
  ) {
    super('AddSyncDevice', data, id, timestamp, version, fromRemote)
  }

  /**
   * Executes the command to add a sync device
   * @inheritdoc
   * @throws {InvalidCommandError} If the command data is invalid.
   */
  async execute(mediator: FavaLibMediator) {
    const syncManager = mediator.getComponent('syncManager')
    if (!this.validate()) {
      throw new InvalidCommandError('Invalid AddEntry command')
    }
    await syncManager.addSyncDevice(this.data)
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
    // TODO: actually validate
    return true
  }
}

export default AddSyncDeviceCommand
