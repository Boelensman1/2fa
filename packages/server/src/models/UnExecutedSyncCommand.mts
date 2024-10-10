import { Model } from 'objection'

import type { DeviceId, Encrypted, EncryptedSymmetricKey } from '2falib'

class UnExecutedSyncCommand extends Model {
  static readonly tableName = 'unExecutedSyncCommands'

  id!: number

  deviceId!: DeviceId

  encryptedCommands!: Encrypted<string>

  encryptedSymmetricKey!: EncryptedSymmetricKey

  createdAt!: Date
}

export default UnExecutedSyncCommand
