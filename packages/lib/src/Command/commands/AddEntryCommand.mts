import { InvalidCommandError } from '../../FavaLibError.mjs'
import type FavaLibMediator from '../../FavaLibMediator.mjs'
import Command from '../BaseCommand.mjs'
import type Entry from '../../interfaces/Entry.mjs'
import DeleteEntryCommand from './DeleteEntryCommand.mjs'
import {
  validateEntryFatal,
  validateEntryStrict,
} from '../../utils/entryValidation.mjs'

export type AddEntryData = Entry

/**
 * Represents a command that when executed add an entry to the vault.
 */
class AddEntryCommand extends Command<AddEntryData> {
  /**
   * Creates a new AddEntryCommand instance.
   * @inheritdoc
   * @param data - The data of the entry to be added.
   */
  constructor(
    data: AddEntryData,
    id?: string,
    timestamp?: number,
    version?: string,
    fromRemote = false,
  ) {
    super('AddEntry', data, id, timestamp, version, fromRemote)
  }

  /**
   * Executes the command to add the entry to the vault.
   * @inheritdoc
   * @throws {InvalidCommandError} If the command data is invalid.
   */
  async execute(mediator: FavaLibMediator) {
    const vault = mediator.getComponent('vaultDataManager')
    const reason = this.invalidReason()
    if (reason) {
      throw new InvalidCommandError(`Invalid AddEntry command: ${reason}`)
    }
    await vault.addEntry(this.data)
  }

  /**
   * @inheritdoc
   */
  createUndoCommand(): Command {
    return DeleteEntryCommand.create({ entryId: this.data.id })
  }

  /**
   * Checks the command data.
   *
   * Commands that came from a peer are held to the weaker of the two tiers:
   * `CommandManager.processRemoteCommands` drops a command that throws and
   * never retries it, so rejecting an entry over a repairable problem would
   * lose it on this device permanently. `VaultDataManager` sanitises the
   * matching fields on the way in instead.
   * @returns The reason the command is invalid, or null when it is valid.
   */
  private invalidReason(): string | null {
    return this.fromRemote
      ? validateEntryFatal(this.data)
      : validateEntryStrict(this.data)
  }

  /**
   * Validates the command data.
   * @returns True if the command data is valid, false otherwise.
   */
  validate(): boolean {
    return this.invalidReason() === null
  }
}

export default AddEntryCommand
