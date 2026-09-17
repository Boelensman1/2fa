import type { KdfParameters } from './utils/canonical.mjs'

/**
 * Version constants for the library.
 *
 * This module deliberately imports nothing at runtime: it is read from both
 * `creationUtils` and `PersistentStorageManager`, which already sit on a
 * runtime import cycle with `FavaLib`. Keeping it a leaf makes it safe to read
 * at module scope from anywhere.
 */

/**
 * The version of this library. Must match the "version" field in
 * packages/lib/package.json; tests/version.test.mts pins that.
 *
 * Purely informational: it is recorded in every stored vault so a consumer can
 * tell which build last wrote it. It must never decide whether a vault opens --
 * that is what STORAGE_VERSION is for.
 */
export const LIB_VERSION = '0.0.22'

/**
 * The version of the LockedRepresentation envelope that this build writes, and
 * the highest one it is able to read. A stored vault claiming a higher number
 * was written by a newer library and is refused rather than misread.
 *
 * Version 2: argon2id at m=64 MiB/t=3/p=4, AES-256-GCM with AAD in place of
 * AES-256-CBC, an `envelopeMac` keyed from the password hash, and -- replacing
 * the RSA layer -- X25519 for key agreement and Ed25519 for signatures, both
 * secret keys sealed under a key derived from the password hash rather than
 * wrapped to the device's own public key.
 *
 * Note that version 2 was REDEFINED rather than superseded when the curves
 * landed. The rule, worth stating once because it applies to all three of these
 * constants: a format that has never shipped is redefined in place, not
 * re-versioned. No version 2 vault had ever been written outside this
 * repository, so a version 3 would only have added a read path for a format
 * with no readers.
 *
 * There is no read path for version 1. It was deleted rather than migrated: a
 * v1 blob dropped over a v2 vault used to open and be silently upgraded -- a
 * downgrade window wider than plain rollback, needing no matching salt or kdf
 * block. A v1 vault is refused; the way across is to export the entries under
 * the older build and import them here.
 */
export const STORAGE_VERSION = 2

/**
 * The version of the unlocked-session blob that this build writes, and the
 * only one it will read.
 *
 * Deliberately separate from STORAGE_VERSION, because the two version
 * artifacts with opposite obligations. A stored vault must open forever: a
 * bump there drags in a frozen fixture, a read path for the old version and a
 * migration, and getting it wrong costs a user their vault. An unlocked
 * session is memory-backed and lives for one process; it is never migrated,
 * and the right answer to one this build does not recognise is to refuse it
 * and ask for the password again. Tying them together would force a storage
 * bump to add a field to a throwaway blob, and would kill every live session
 * on every storage bump for no reason.
 *
 * Compared with !==, not <. An older blob means the process was upgraded under
 * a live session and a newer one means a downgrade; neither is a shape this
 * build should guess at, and both cost exactly one password prompt.
 *
 * Version 2 carries the device's two curve secret keys where version 1 carried
 * an RSA private key and its public key. This is the one version constant that
 * was BUMPED rather than redefined in place, for the reason the paragraph above
 * gives: refusing a session holding key material this build cannot use costs
 * one password prompt.
 */
export const SESSION_VERSION = 2

/**
 * The sync command wire-protocol version this build speaks. Only the major
 * component is compared; a remote command with a higher major is dropped
 * rather than misapplied.
 *
 * Bumped to 2.0 with storage version 2, which moved the sync wire to the v2
 * ciphertext envelope with no fallback. Note this is bookkeeping, not the
 * gate: `commandVersionIsSupported` accepts OLDER majors, so a v1 peer's
 * command fails earlier, in decryption.
 *
 * Version 2 also means SIGNED. A command now travels as a
 * SignedCommandEnvelope and is refused unless a device currently in this
 * vault's peer list signed it, for this recipient, under this command id. There
 * is no unsigned fallback and no grace period, and no version bump for it, for
 * the reason STORAGE_VERSION gives: no 2.0 command has ever left this
 * repository.
 */
export const COMMAND_VERSION = '2.0'

/**
 * The version of the add-device pairing payload -- the JSON behind the QR code
 * or connection string an initiator hands to a responder out of band.
 *
 * Only the major component is compared, and unlike COMMAND_VERSION the gate is
 * an exact match in both directions rather than "anything older is fine". The
 * major tracks the JPAKE wire format, and that format is not backward
 * compatible: jpake-ts 2 binds each Schnorr proof to its generator and hashes
 * the session key over a transcript, so it rejects a 1.x peer's pass 1 outright
 * and would not reach the same key even if it did not. There is nothing useful
 * a mismatched pair can do, so the responder refuses early with an error naming
 * which side is behind, rather than letting it surface as a proof failure.
 *
 * Major 2 is jpake-ts 2.x. A payload carrying no pairingVersion at all predates
 * this field, which means a build on jpake-ts 1.x, and so is treated as major 1
 * and refused.
 *
 * The handshake under it changed with storage version 2 -- the responder now
 * sends both of its public keys where it used to send one RSA key -- and the
 * major did NOT move for it, by the same "unshipped is redefined" rule. A peer
 * that could send the old shape is on jpake-ts 1.x and is already refused here
 * by version, before it can send anything at all.
 */
export const PAIRING_VERSION = '2.0'

/**
 * The argon2id parameters used by `createSyncKey` to derive a sync key from a
 * JPAKE shared secret.
 *
 * Cheap on purpose, and not a password KDF: the input already carries the full
 * entropy of an ECC shared secret, so there is nothing for an attacker to
 * grind and no reason to pay for stretching it. Passwords go through
 * V2_KDF_PARAMETERS instead.
 *
 * These are hash-wasm's README example, copied verbatim, which is also where
 * storage version 1 got them -- history rather than a reason, since the v1 read
 * path is gone and these are not. `memorySize` is in KiB, so this is 512 KiB.
 */
export const SYNC_KDF_PARAMETERS: KdfParameters = {
  algorithm: 'argon2id',
  memorySize: 512,
  iterations: 256,
  parallelism: 1,
  hashLength: 64,
}

/**
 * The argon2id parameters used by storage version 2 and written into every new
 * vault.
 *
 * m = 64 MiB, t = 3, p = 4 -- Bitwarden's documented default, measured at
 * ~259 ms, roughly 192x the attacker cost of the parameters storage version 1
 * used. `memorySize` is in KiB.
 */
export const V2_KDF_PARAMETERS: KdfParameters = {
  algorithm: 'argon2id',
  memorySize: 65536,
  iterations: 3,
  parallelism: 4,
  hashLength: 64,
}
