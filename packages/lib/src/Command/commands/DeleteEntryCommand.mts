import { InvalidCommandError } from '../../TwoFALibError.mjs'
import Command from '../BaseCommand.mjs'
import type InternalVaultManager from '../../subclasses/VaultDataManager.mjs'
import type { EntryId } from '../../interfaces/Entry.mjs'

import AddEntryCommand from './AddEntryCommand.mjs'
import Entry from '../../interfaces/Entry.mjs'

export interface DeleteEntryData {
  entryId: EntryId
}

/**
 * Represents a command that when executed deletes an entry from the vault.
 */
class DeleteEntryCommand extends Command<DeleteEntryData> {
  private deletedEntry?: Entry

  /**
   * Creates a new DeleteEntryCommand instance.
   * @inheritdoc
   * @param data - The data of the entry to be deleted.
   */
  constructor(
    data: DeleteEntryData,
    id?: string,
    timestamp?: number,
    version?: string,
    fromRemote = false,
  ) {
    super('DeleteEntry', data, id, timestamp, version, fromRemote)
  }

  /**
   * Executes the command to delete the entry from the vault.
   * @inheritdoc
   * @throws {InvalidCommandError} If the command data is invalid or the entry doesn't exist.
   */
  async execute(vault: InternalVaultManager) {
    if (!this.validate()) {
      throw new InvalidCommandError('Invalid DeleteEntry command')
    }
    this.deletedEntry = vault.getFullEntry(this.data.entryId)
    if (this.deletedEntry === undefined) {
      throw new InvalidCommandError(
        `Entry with id ${this.data.entryId} does not exist`,
      )
    }
    await vault.deleteEntry(this.data.entryId)
  }

  /**
   * @inheritdoc
   * @throws {InvalidCommandError} If the deleted entry content is not available.
   */
  createUndoCommand(): Command {
    if (this.deletedEntry === undefined) {
      throw new InvalidCommandError(
        'Cannot create undo command, content not available',
      )
    }
    return AddEntryCommand.create(this.deletedEntry)
  }

  /**
   * Validates the command data.
   * @returns True if the command data is valid, false otherwise.
   */
  validate(): boolean {
    return this.data.entryId !== undefined
  }
}

export default DeleteEntryCommand
