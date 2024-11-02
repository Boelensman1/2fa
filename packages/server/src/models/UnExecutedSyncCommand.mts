import { Model } from 'objection'

import type { DeviceId, Encrypted, EncryptedSymmetricKey } from '2falib'

class UnExecutedSyncCommand extends Model {
  static readonly tableName = 'unExecutedSyncCommands'
  static readonly idColumn = 'commandId'

  commandId!: string

  deviceId!: DeviceId

  encryptedCommand!: Encrypted<string>

  encryptedSymmetricKey!: EncryptedSymmetricKey

  createdAt!: Date
}

export default UnExecutedSyncCommand
