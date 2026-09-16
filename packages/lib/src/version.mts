/**
 * Version constants for the library.
 *
 * This module deliberately imports nothing: it is read from both
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
export const LIB_VERSION = '0.0.21'

/**
 * The version of the LockedRepresentation envelope that this build writes, and
 * the highest one it is able to read. A stored vault claiming a higher number
 * was written by a newer library and is refused rather than misread.
 */
export const STORAGE_VERSION = 1

/**
 * The storage version assumed for a stored vault that carries no
 * storageVersion at all.
 */
export const LEGACY_STORAGE_VERSION = 1

/**
 * The sync command wire-protocol version this build speaks. Only the major
 * component is compared; a remote command with a higher major is dropped
 * rather than misapplied.
 */
export const COMMAND_VERSION = '1.0'
