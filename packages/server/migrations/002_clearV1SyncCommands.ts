/* eslint-disable jsdoc/require-jsdoc */
import type { Knex } from 'knex'

/**
 * Clears the queue of undelivered sync commands.
 *
 * favalib storage version 2 moved the sync wire to the authenticated v2
 * ciphertext envelope with no fallback, as a deliberate clean break: peers
 * upgrade together. Every row written before that upgrade holds an
 * AES-256-CBC `encryptedCommand` with an RSA-OAEP/MGF1-SHA-1 key wrap, which
 * no upgraded client can decrypt.
 *
 * Those rows have no expiry, and the server redelivers every queued command on
 * each reconnect, so leaving them in place would make every client warn about
 * the same undecryptable commands forever. Deleting them loses only commands
 * that were already undeliverable.
 *
 * Deliberately not reversible: `down` is a no-op rather than an error, because
 * there is nothing to restore -- rolling the schema back cannot bring back
 * ciphertext this migration deleted, and failing here would block an otherwise
 * legitimate rollback of migration 001.
 * @param knex - The knex instance to run against.
 */
export const up = async (knex: Knex) => {
  await knex('unExecutedSyncCommands').del()
}

export const down = async () => {
  // Nothing to undo: see above.
}
