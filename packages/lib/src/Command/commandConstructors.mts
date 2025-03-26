import AddEntryCommand from './commands/AddEntryCommand.mjs'
import AddSyncDeviceCommand from './commands/AddSyncDeviceCommand.mjs'
import DeleteEntryCommand from './commands/DeleteEntryCommand.mjs'
import UpdateEntryCommand from './commands/UpdateEntryCommand.mjs'
import ChangeSyncDeviceMetaCommand from './commands/ChangeSyncDeviceMetaCommand.mjs'

const commandConstructors = {
  AddEntry: AddEntryCommand,
  DeleteEntry: DeleteEntryCommand,
  UpdateEntry: UpdateEntryCommand,
  AddSyncDevice: AddSyncDeviceCommand,
  ChangeSyncDeviceMeta: ChangeSyncDeviceMetaCommand,
}

export default commandConstructors
