import { Model } from 'objection'

import type { DeviceId, Encrypted, EncryptedSymmetricKey } from 'favalib'

class UnExecutedSyncCommand extends Model {
  static readonly tableName = 'unExecutedSyncCommands'
  static readonly idColumn = 'id'

  id!: number

  commandId!: string

  deviceId!: DeviceId

  encryptedCommand!: Encrypted<string>

  encryptedSymmetricKey!: EncryptedSymmetricKey

  createdAt!: Date
}

export default UnExecutedSyncCommand
