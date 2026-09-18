/* eslint-disable jsdoc/require-jsdoc */
import type { Knex } from 'knex'

/**
 * Clears the queue of undelivered sync commands, a third time.
 *
 * Storage version 2 has been REDEFINED again, and this time for the reason the
 * other two were not: the curves it used are discrete-log problems, so every
 * queued row is a ciphertext a future quantum adversary could open. A command's
 * symmetric key now travels as a hybrid seal -- X25519 and ML-KEM-768 combined
 * -- and every signature is a composite of Ed25519 and ML-DSA-65.
 *
 * Every queued row predating that fails on both counts. The seal is four
 * colon-separated fields where a current one has five, so it is refused on
 * shape before any arithmetic is attempted, and the signature inside it is 64
 * bytes where a current one is 3373.
 *
 * Same reasoning as 002 and 003, and the same shape: rows have no expiry, the
 * server redelivers the whole queue on every reconnect, and deleting them loses
 * only commands that were already undeliverable. Leaving them would be worse
 * than useless -- they are exactly the recorded ciphertexts this change exists
 * to stop accumulating.
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
