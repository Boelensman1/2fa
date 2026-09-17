import { InvalidCommandError, FavaLibError } from '../../FavaLibError.mjs'
import type FavaLibMediator from '../../FavaLibMediator.mjs'
import Command from '../BaseCommand.mjs'
import type { DeviceId, DeviceInfo } from '../../interfaces/SyncTypes.mjs'
import type {
  PublicKey,
  SigningPublicKey,
} from '../../interfaces/CryptoLib.mjs'
import { validateSyncDevice } from '../../utils/syncDeviceValidation.mjs'

export interface AddSyncDeviceData {
  deviceId: DeviceId
  publicKey: PublicKey
  signingPublicKey: SigningPublicKey
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
    const reason = this.invalidReason()
    if (reason) {
      throw new InvalidCommandError(`Invalid AddSyncDevice command: ${reason}`)
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
   * Says why the command data is unusable.
   *
   * A shape gate only, matching the tier AddEntryCommand applies to a remote
   * entry. It does **not** by itself make device enrolment safe: a well formed
   * record carrying an attacker's public keys passes every check here.
   *
   * What changed with signed commands is who can get such a record this far.
   * This command now has to arrive signed by a device already in the peer list,
   * so enrolment is closed to anyone merely holding a public key -- but a
   * trusted peer can still enrol whatever it likes, there is no key pinning and
   * no visible confirmation. That is
   * key-hierarchy-review/14-sync-device-injection.md, and it is still open.
   * @returns Null when the data is usable, otherwise the reason it is not.
   */
  invalidReason(): string | null {
    return validateSyncDevice(this.data)
  }

  /**
   * Validates the command data.
   * @returns True if the command data is valid, false otherwise.
   */
  validate(): boolean {
    return this.invalidReason() === null
  }
}

export default AddSyncDeviceCommand
