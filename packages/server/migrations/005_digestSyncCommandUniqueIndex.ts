/* eslint-disable jsdoc/require-jsdoc */
import type { Knex } from 'knex'

/**
 * Moves the `encryptedCommand` uniqueness onto a digest column.
 *
 * A btree index entry cannot exceed about a third of an 8 KiB page, roughly
 * 2704 bytes, and `encryptedCommand` now always does. Every sync command
 * carries a composite Ed25519 ++ ML-DSA-65 signature INSIDE its ciphertext --
 * 3373 raw bytes, 4500 base64 characters -- so an insert fails outright with
 * "Values larger than 1/3 of a buffer page cannot be indexed", the client never
 * gets an acknowledgement, and it retries the same command for ever while sync
 * silently does nothing.
 *
 * (The limit was always reachable, by a large enough command. What the
 * signature changed is that it is now unreachable NOT to hit it.)
 *
 * The constraint is kept rather than dropped, on a digest of the value instead
 * of the value itself. It was never the real key -- `(commandId, deviceId)` is,
 * and a client refuses any envelope whose signed command id does not match the
 * one it was delivered under -- but it is defence in depth against the same
 * ciphertext being queued twice, and losing that should be someone's decision
 * rather than a side effect of a page size.
 *
 * The digest is computed by the server -- in `UnExecutedSyncCommand`'s
 * $beforeInsert, so no insert site can forget it -- and written as a column,
 * rather than by an expression index or a generated column. Both of those need
 * their expression to be IMMUTABLE, and `convert_to` is only STABLE (its result
 * depends on the database encoding), so neither will accept sha256 over a text
 * column at all. The alternative Postgres suggests in its own hint is md5,
 * which is built in and immutable; it is declined here because a collision does
 * not merely waste a row. `storeSyncCommand` answers a unique violation by
 * looking the row up by `(commandId, deviceId)`, and a collision between two
 * genuinely different commands finds nothing, refuses to acknowledge, and
 * leaves that command retrying in a client's queue for ever.
 *
 * No backfill: migration 004 empties this table, and it runs first.
 * @param knex - The knex instance to run against.
 */
export const up = async (knex: Knex) => {
  await knex.schema.alterTable('unExecutedSyncCommands', (table) => {
    table.dropUnique(['encryptedCommand'])
    table.string('encryptedCommandDigest', 44).notNullable().unique()
  })
}

export const down = async (knex: Knex) => {
  await knex.schema.alterTable('unExecutedSyncCommands', (table) => {
    table.dropColumn('encryptedCommandDigest')
    table.unique(['encryptedCommand'])
  })
}
