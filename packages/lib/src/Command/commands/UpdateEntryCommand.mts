import { InvalidCommandError } from '../../TwoFALibError.mjs'
import type InternalVaultManager from '../../subclasses/InternalVaultManager.mjs'
import Command from '../BaseCommand.mjs'
import type Entry from '../../interfaces/Entry.mjs'
import { EntryId } from '../../interfaces/Entry.mjs'

export interface UpdateEntryData {
  entryId: EntryId
  oldEntry: Entry
  updatedEntry: Entry
}

class UpdateEntryCommand extends Command<UpdateEntryData> {
  private originalEntry?: Entry

  constructor(
    data: UpdateEntryData,
    id?: string,
    timestamp?: number,
    version?: string,
    fromRemote = false,
  ) {
    super('UpdateEntry', data, id, timestamp, version, fromRemote)
  }

  async execute(vault: InternalVaultManager) {
    if (!this.validate()) {
      throw new InvalidCommandError('Invalid UpdateEntry command')
    }
    await vault.updateEntry(this.data.updatedEntry)
  }

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

  validate(): boolean {
    // TODO: write the validate function
    return true
  }
}

export default UpdateEntryCommand
