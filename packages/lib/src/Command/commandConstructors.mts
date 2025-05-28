import AddEntryCommand from './commands/AddEntryCommand.mjs'
import AddSyncDeviceCommand from './commands/AddSyncDeviceCommand.mjs'
import DeleteEntryCommand from './commands/DeleteEntryCommand.mjs'
import UpdateEntryCommand from './commands/UpdateEntryCommand.mjs'
import ChangeSyncDeviceInfoCommand from './commands/ChangeDeviceInfoCommand.mjs'

const commandConstructors = {
  AddEntry: AddEntryCommand,
  DeleteEntry: DeleteEntryCommand,
  UpdateEntry: UpdateEntryCommand,
  AddSyncDevice: AddSyncDeviceCommand,
  ChangeSyncDeviceInfo: ChangeSyncDeviceInfoCommand,
}

export default commandConstructors
