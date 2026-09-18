import { createHash } from 'node:crypto'

import { Model } from 'objection'

import type { DeviceId, Encrypted, EncryptedSymmetricKey } from 'favalib/types'

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

  /**
   * base64 SHA-256 of `encryptedCommand`, carrying its uniqueness constraint.
   *
   * The ciphertext itself cannot be indexed: it holds a composite Ed25519 ++
   * ML-DSA-65 signature and so always exceeds Postgres's btree entry limit of
   * about 2704 bytes. See migration 005.
   *
   * Filled in by $beforeInsert below, never by a caller.
   */
  encryptedCommandDigest!: string

  encryptedSymmetricKey!: EncryptedSymmetricKey

  createdAt!: Date

  /**
   * Derives the digest from the ciphertext on the way into the database.
   *
   * Here rather than at the call site so that it cannot be forgotten. It is not
   * a value anyone supplies -- it is a function of another column, and the only
   * reason it is a column at all is that Postgres will not index the expression
   * itself (`convert_to` is merely STABLE, so neither an expression index nor a
   * generated column will accept it). Leaving it to callers would mean a
   * NotNullViolation for whoever wrote the next insert.
   */
  $beforeInsert() {
    this.encryptedCommandDigest = createHash('sha256')
      .update(this.encryptedCommand, 'utf8')
      .digest('base64')
  }
}

export default UnExecutedSyncCommand
