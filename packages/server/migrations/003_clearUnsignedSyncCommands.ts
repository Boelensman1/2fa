/* eslint-disable jsdoc/require-jsdoc */
import type { Knex } from 'knex'

/**
 * Clears the queue of undelivered sync commands, a second time.
 *
 * Storage version 2 was REDEFINED before it ever shipped: the RSA layer is
 * gone, so a command's symmetric key now travels as an X25519 seal rather than
 * an RSA-OAEP wrap, and the command itself carries a signature from the sending
 * device. Every queued row predating that change fails on both counts -- the
 * key does not unseal, and the payload inside it carries no signature -- so no
 * current client can act on one.
 *
 * Same reasoning as 002, and the same shape: rows have no expiry, the server
 * redelivers the whole queue on every reconnect, and deleting them loses only
 * commands that were already undeliverable. The difference is who it affects:
 * 002 cleaned up after a shipped format, this one after an unshipped one, so in
 * practice it empties development queues rather than anyone's real vault.
 *
 * Deliberately not reversible, for the reason 002 gives.
 * @param knex - The knex instance to run against.
 */
export const up = async (knex: Knex) => {
  await knex('unExecutedSyncCommands').del()
}

export const down = async () => {
  // Nothing to undo: see above.
}
