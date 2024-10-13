import AddEntryCommand from './commands/AddEntryCommand.mjs'
import DeleteEntryCommand from './commands/DeleteEntryCommand.mjs'
import UpdateEntryCommand from './commands/UpdateEntryCommand.mjs'

const commandConstructors = {
  AddEntry: AddEntryCommand,
  DeleteEntry: DeleteEntryCommand,
  UpdateEntry: UpdateEntryCommand,
}

export default commandConstructors
