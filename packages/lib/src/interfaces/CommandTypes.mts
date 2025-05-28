import type { AddEntryData } from '../Command/commands/AddEntryCommand.mjs'
import type { DeleteEntryData } from '../Command/commands/DeleteEntryCommand.mjs'
import type { UpdateEntryData } from '../Command/commands/UpdateEntryCommand.mjs'
import type { AddSyncDeviceData } from '../Command/commands/AddSyncDeviceCommand.mjs'
import type { ChangeSyncDeviceInfoData } from '../Command/commands/ChangeDeviceInfoCommand.mjs'

export type SyncCommand = (
  | { type: 'AddEntry'; data: AddEntryData }
  | { type: 'DeleteEntry'; data: DeleteEntryData }
  | { type: 'UpdateEntry'; data: UpdateEntryData }
  | { type: 'AddSyncDevice'; data: AddSyncDeviceData }
  | { type: 'ChangeSyncDeviceInfo'; data: ChangeSyncDeviceInfoData }
) & { id: string }
export type CommandData =
  | AddEntryData
  | DeleteEntryData
  | UpdateEntryData
  | AddSyncDeviceData
  | ChangeSyncDeviceInfoData
