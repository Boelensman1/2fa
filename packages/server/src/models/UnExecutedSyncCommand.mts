import { Model } from 'objection'

import type { DeviceId, Encrypted, EncryptedSymmetricKey } from 'favalib'

/**
 * Represents a command that has not yet been executed.
 * This model is used to store commands that are pending execution
 * in the unExecutedSyncCommands table.
 */
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
