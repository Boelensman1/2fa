# 03 — `storageVersion` is write-only

**Verdict:** weak — silent downgrade path
**Status:** open
**Priority:** P0 — prerequisite for [01](01-kdf-parameters.md) and
[02](02-ciphertext-authenticity.md)
**Touches:** `src/utils/creationUtils.mts:172`,
`src/subclasses/PersistentStorageManager.mts:32`

## Finding

`LockedRepresentation` carries `storageVersion` (currently `1`) and
`libVersion`, and **nothing reads either one**. Every occurrence in non-build
source is a declaration or a write:

- `src/interfaces/Vault.mts:24-25` — type declaration
- `src/subclasses/PersistentStorageManager.mts:32` — `static readonly storageVersion = 1`
- `src/subclasses/PersistentStorageManager.mts:115-116` — written into the JSON
- `tests/subclasses/PersistentStorageManager.test.mts:99-100` — asserts
  `expect.any(Number)`, so it does not even pin the value

`loadFavaLibFromLockedRepesentation` (`src/utils/creationUtils.mts:172-184`)
destructures only `encryptedPrivateKey`, `encryptedSymmetricKey`, `salt` and
`encryptedVaultState`. A grep for `migrat|upgrade` across `packages/lib/src`,
`packages/app-browser/src` and `packages/app-cli/src` returns zero hits — the
only migrations in the repo are the server's knex DB migrations.

Consequences:

- **An older lib opens a newer blob** and then re-`save()`s it in the old shape.
  Silent data loss and a rollback vector.
- There is no "too new to open" guard, so no format change can be made safely
  until this exists.
- `libVersion` is the hardcoded literal `'0.0.1'` (`FavaLib.mts:55`), not read
  from package.json, so it carries no information at all.

The same pattern applies to sync commands: `BaseCommand.version` defaults to
`'1.0'` (`src/Command/BaseCommand.mts:24,32,38`), is serialised and rehydrated,
and is never compared.

## What to do

Add a read in `src/utils/creationUtils.mts:172` that rejects
`storageVersion > PersistentStorageManager.storageVersion` with a clear error,
before any decryption is attempted. ~10 lines.

Optionally make `libVersion` meaningful (read from package.json) or drop it —
as it stands it is dead weight in every stored vault.

Note this is only a **same-device** downgrade concern. `LockedRepresentation`
never crosses the wire (see the README), so there is no peer-compatibility
dimension to the at-rest format.

## How to verify

Hand-craft a `LockedRepresentation` with `storageVersion: 99` and confirm it is
refused with a clear error rather than a decryption failure or a silent
re-save.

## Resolution

_Not started._
