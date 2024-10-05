import AddEntryCommand, {
  type AddEntryData,
} from './commands/AddEntryCommand.mjs'
import DeleteEntryCommand, {
  type DeleteEntryData,
} from './commands/DeleteEntryCommand.mjs'
import UpdateEntryCommand, {
  type UpdateEntryData,
} from './commands/UpdateEntryCommand.mjs'

export const commandConstructors = {
  AddEntry: AddEntryCommand,
  DeleteEntry: DeleteEntryCommand,
  UpdateEntry: UpdateEntryCommand,
}

export type SyncCommand =
  | { type: 'AddEntry'; data: AddEntryData }
  | { type: 'DeleteEntry'; data: DeleteEntryData }
  | { type: 'UpdateEntry'; data: UpdateEntryData }
export type CommandData = AddEntryData | DeleteEntryData | UpdateEntryData
