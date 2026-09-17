import { InvalidCommandError } from '../../FavaLibError.mjs'
import type FavaLibMediator from '../../FavaLibMediator.mjs'
import Command from '../BaseCommand.mjs'
import type { DeviceId } from '../../interfaces/BrandedTypes.mjs'
import type Entry from '../../interfaces/Entry.mjs'
import { EntryId } from '../../interfaces/Entry.mjs'
import {
  validateEntryFatal,
  validateEntryStrict,
} from '../../utils/entryValidation.mjs'

export interface UpdateEntryData {
  entryId: EntryId
  oldEntry: Entry
  updatedEntry: Entry
}

/**
 * Represents a command that when executed updates an entry in the vault.
 */
class UpdateEntryCommand extends Command<UpdateEntryData> {
  private originalEntry?: Entry

  /**
   * Creates a new UpdateEntryCommand instance.
   * @inheritdoc
   * @param data - The data containing the entry to be updated.
   */
  constructor(
    data: UpdateEntryData,
    id?: string,
    timestamp?: number,
    version?: string,
    fromRemote = false,
    fromDeviceId?: DeviceId,
  ) {
    super('UpdateEntry', data, id, timestamp, version, fromRemote, fromDeviceId)
  }

  /**
   * Executes the command to update the entry in the vault.
   * @inheritdoc
   * @throws {InvalidCommandError} If the command data is invalid.
   */
  async execute(mediator: FavaLibMediator) {
    const reason = this.invalidReason()
    if (reason) {
      throw new InvalidCommandError(`Invalid UpdateEntry command: ${reason}`)
    }
    const vault = mediator.getComponent('vaultDataManager')
    this.originalEntry = vault.getFullEntry(this.data.entryId)
    await vault.updateEntry(this.data.updatedEntry)
  }

  /**
   * @inheritdoc
   * @throws {InvalidCommandError} If the original entry is not available.
   */
  createUndoCommand(): Command {
    if (!this.originalEntry) {
      throw new InvalidCommandError(
        'Cannot create undo command, original entry not available',
      )
    }
    return new UpdateEntryCommand({
      entryId: this.data.entryId,
      oldEntry: this.data.updatedEntry,
      updatedEntry: this.data.oldEntry,
    })
  }

  /**
   * Checks the command data.
   *
   * See `AddEntryCommand` for why remote commands get the weaker tier.
   * @returns The reason the command is invalid, or null when it is valid.
   */
  private invalidReason(): string | null {
    if (typeof this.data?.entryId !== 'string' || !this.data.entryId) {
      return 'no entryId'
    }
    if (this.data.updatedEntry?.id !== this.data.entryId) {
      return 'updatedEntry.id does not match entryId'
    }
    // Validate only the replacement, so older entries can be repaired.
    const check = this.fromRemote ? validateEntryFatal : validateEntryStrict
    return check(this.data.updatedEntry)
  }

  /**
   * Validates the command data.
   * @returns True if the command data is valid, false otherwise.
   */
  validate(): boolean {
    return this.invalidReason() === null
  }
}

export default UpdateEntryCommand
