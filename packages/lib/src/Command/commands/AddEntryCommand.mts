import { InvalidCommandError } from '../../TwoFALibError.mjs'
import type TwoFaLibMediator from '../../TwoFaLibMediator.mjs'
import Command from '../BaseCommand.mjs'
import type Entry from '../../interfaces/Entry.mjs'
import DeleteEntryCommand from './DeleteEntryCommand.mjs'

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
  async execute(mediator: TwoFaLibMediator) {
    const vault = mediator.getComponent('vaultDataManager')
    if (!this.validate()) {
      throw new InvalidCommandError('Invalid AddEntry command')
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
   * Validates the command data.
   * @returns True if the command data is valid, false otherwise.
   */
  validate(): boolean {
    // TODO: actually validate
    return this.data.id !== undefined
  }
}

export default AddEntryCommand
