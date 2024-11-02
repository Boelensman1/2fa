import type { AddEntryData } from '../Command/commands/AddEntryCommand.mjs'
import type { DeleteEntryData } from '../Command/commands/DeleteEntryCommand.mjs'
import type { UpdateEntryData } from '../Command/commands/UpdateEntryCommand.mjs'

export type SyncCommand = (
  | { type: 'AddEntry'; data: AddEntryData }
  | { type: 'DeleteEntry'; data: DeleteEntryData }
  | { type: 'UpdateEntry'; data: UpdateEntryData }
) & { id: string }
export type CommandData = AddEntryData | DeleteEntryData | UpdateEntryData
