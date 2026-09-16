import type { AddEntryData } from '../Command/commands/AddEntryCommand.mjs'
import type { DeleteEntryData } from '../Command/commands/DeleteEntryCommand.mjs'
import type { UpdateEntryData } from '../Command/commands/UpdateEntryCommand.mjs'
import type { AddSyncDeviceData } from '../Command/commands/AddSyncDeviceCommand.mjs'
import type { ChangeDeviceInfoData } from '../Command/commands/ChangeDeviceInfoCommand.mjs'
import type { RemoveSyncDeviceData } from '../Command/commands/RemoveSyncDeviceCommand.mjs'

export type SyncCommand = (
  | { type: 'AddEntry'; data: AddEntryData }
  | { type: 'DeleteEntry'; data: DeleteEntryData }
  | { type: 'UpdateEntry'; data: UpdateEntryData }
  | { type: 'AddSyncDevice'; data: AddSyncDeviceData }
  | { type: 'ChangeDeviceInfo'; data: ChangeDeviceInfoData }
  | { type: 'RemoveSyncDevice'; data: RemoveSyncDeviceData }
) & {
  id: string
  // Serialised by BaseCommand.toJSON and read back by fromJSON, so these are
  // genuinely on the wire. Optional because a peer on an older build may omit
  // them, and because the type predates them.
  version?: string
  timestamp?: number
}
export type CommandData =
  | AddEntryData
  | DeleteEntryData
  | UpdateEntryData
  | AddSyncDeviceData
  | ChangeDeviceInfoData
  | RemoveSyncDeviceData
