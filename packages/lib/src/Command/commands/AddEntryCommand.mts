import type InternalVaultManager from '../../subclasses/InternalVaultManager.mjs'
import Command from '../BaseCommand.mjs'
import type Entry from '../../interfaces/Entry.mjs'
import DeleteEntryCommand from './DeleteEntryCommand.mjs'

export type AddEntryData = Entry

class AddEntryCommand extends Command<AddEntryData> {
  constructor(
    data: AddEntryData,
    id?: string,
    timestamp?: number,
    version?: string,
    fromRemote = false,
  ) {
    super('AddEntry', data, id, timestamp, version, fromRemote)
  }

  async execute(vault: InternalVaultManager) {
    if (!this.validate()) {
      throw new Error('Invalid AddEntry command')
    }
    await vault.addEntry(this.data)
  }

  createUndoCommand(): Command {
    return DeleteEntryCommand.create({ entryId: this.data.id })
  }

  validate(): boolean {
    // TODO: actually validate
    return this.data.id !== undefined
  }
}

export default AddEntryCommand
