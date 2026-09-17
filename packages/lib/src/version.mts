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
 * Version 2 (key-hierarchy-review/01 and /02): argon2id at m=64 MiB/t=3/p=4,
 * AES-256-GCM with additional authenticated data in place of AES-256-CBC,
 * RSA-OAEP with MGF1-SHA-256 in place of MGF1-SHA-1, and an `envelopeMac`
 * keyed from the password hash.
 */
export const STORAGE_VERSION = 2

/**
 * The storage version assumed for a stored vault that carries no
 * storageVersion at all.
 *
 * TO BE REMOVED. Reading version 1 is a migration path, not a supported
 * format: `loadFavaLibFromLockedRepesentation` re-wraps any v1 vault it opens
 * to STORAGE_VERSION and logs a warning while doing so. Until that read path
 * is gone, a v1 blob dropped over a v2 vault opens and is silently migrated --
 * a downgrade window that is wider than plain rollback, because it needs no
 * matching salt or kdf block (key-hierarchy-review/18-anti-rollback.md).
 * Delete the v1 read path, and this constant with it, once installs have
 * upgraded.
 */
export const LEGACY_STORAGE_VERSION = 1

/**
 * The sync command wire-protocol version this build speaks. Only the major
 * component is compared; a remote command with a higher major is dropped
 * rather than misapplied.
 *
 * Bumped to 2.0 with storage version 2, which moved the sync wire to the v2
 * ciphertext envelope with no fallback. Note this is bookkeeping, not the
 * gate: `commandVersionIsSupported` accepts OLDER majors, so a v1 peer's
 * command fails earlier, in decryption.
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
 */
export const PAIRING_VERSION = '2.0'

/**
 * The argon2id parameters used by storage version 1.
 *
 * These are hash-wasm's README example, copied verbatim; see
 * key-hierarchy-review/01-kdf-parameters.md. They are kept because every vault
 * written before storage version 2 needs them to open, and for nothing else.
 * `memorySize` is in KiB, so this is 512 KiB.
 */
export const V1_KDF_PARAMETERS: KdfParameters = {
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
 * ~259 ms in key-hierarchy-review/01-kdf-parameters.md, roughly 192x the
 * attacker cost of the v1 parameters. `memorySize` is in KiB.
 */
export const V2_KDF_PARAMETERS: KdfParameters = {
  algorithm: 'argon2id',
  memorySize: 65536,
  iterations: 3,
  parallelism: 4,
  hashLength: 64,
}
