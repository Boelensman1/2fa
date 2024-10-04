import Command from '../BaseCommand.mjs'
import type InternalVaultManager from '../../subclasses/InternalVaultManager.mjs'
import type { EntryId } from '../../interfaces/Entry.mjs'

import AddEntryCommand from './AddEntryCommand.mjs'
import Entry from '../../interfaces/Entry.mjs'

export interface DeleteEntryData {
  entryId: EntryId
}

class DeleteEntryCommand extends Command<DeleteEntryData> {
  private deletedEntry?: Entry

  constructor(
    data: DeleteEntryData,
    id?: string,
    timestamp?: number,
    version?: string,
    fromRemote = false,
  ) {
    super('DeleteEntry', data, id, timestamp, version, fromRemote)
  }

  async execute(vault: InternalVaultManager) {
    if (!this.validate()) {
      throw new Error('Invalid DeleteEntry command')
    }
    this.deletedEntry = vault.getFullEntry(this.data.entryId)
    if (this.deletedEntry === undefined) {
      throw new Error(`Entry with id ${this.data.entryId} does not exist`)
    }
    await vault.deleteEntry(this.data.entryId)
  }

  createUndoCommand(): Command {
    if (this.deletedEntry === undefined) {
      throw new Error('Cannot create undo command, content not available')
    }
    return AddEntryCommand.create(this.deletedEntry)
  }

  validate(): boolean {
    return this.data.entryId !== undefined
  }
}

export default DeleteEntryCommand
