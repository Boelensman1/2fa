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
    fromDeviceId?: DeviceId,
  ) {
    super(
      'AddSyncDevice',
      data,
      id,
      timestamp,
      version,
      fromRemote,
      fromDeviceId,
    )
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
    // `fromRemote` is the whole discriminator, and it is exact. This device
    // only ever creates one of these at the end of a pairing flow it took part
    // in (`SyncManager.sendFullVaultDataAndSetDeviceInfo`), so a locally
    // created command IS a pairing. A remote one is a peer saying a device
    // exists -- trust arriving by delegation, which is the case
    // key-hierarchy-review/14-sync-device-injection.md is about.
    await syncManager.addSyncDevice(
      this.data,
      this.fromRemote ? 'peer' : 'pairing',
      this.fromDeviceId,
    )
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
   * The checks that matter are elsewhere and deliberately so. This command has
   * to arrive signed by a device already in the peer list
   * (`SyncManager.verifyCommandEnvelope`), so enrolment is closed to anyone
   * merely holding a public key; and `SyncManager.addSyncDevice` pins keys on
   * first receipt, refuses a device this vault removed, and announces a
   * peer-introduced device rather than letting it arrive silently. A trusted
   * peer enrolling a device is in-model -- see
   * key-hierarchy-review/14-sync-device-injection.md for why, and for what the
   * library does instead of blocking it.
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
