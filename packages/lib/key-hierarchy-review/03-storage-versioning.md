# 03 — `storageVersion` is write-only

**Verdict:** weak — silent downgrade path
**Status:** done
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

Done 2026-09-16. The load path now reads `storageVersion` before anything else
and refuses a vault it cannot read, so the gate that [01](01-kdf-parameters.md)
and [02](02-ciphertext-authenticity.md) need is in place. This change does
**not** bump the format — the blob is still `storageVersion: 1`.

What landed:

- `src/version.mts` (new) holds `LIB_VERSION`, `STORAGE_VERSION`,
  `LEGACY_STORAGE_VERSION` and `COMMAND_VERSION` as plain constants in a module
  that imports nothing. Two divergences from "What to do" above are deliberate:
  the comparison is against `STORAGE_VERSION`, not
  `PersistentStorageManager.storageVersion`, and that static is **deleted**. A
  leaf module can be read from `creationUtils` without adding another edge to
  the `FavaLib → PersistentStorageManager → creationUtils` runtime import cycle
  that already exists, and it let `PersistentStorageManager` drop its runtime
  `FavaLib` import, removing one.
- `StorageVersionError extends InitializationError` in `FavaLibError.mts`,
  exported from `main.mts` along with `STORAGE_VERSION`, `LIB_VERSION` and the
  `LockedRepresentation` type.
- The guard in `creationUtils.mts`, placed **before** the envelope completeness
  check as well as before any decryption: a future v2 blob would otherwise
  report as "incomplete or corrupted" to a v1 build, telling the user their
  vault is broken when it is merely newer. Absent → treated as 1; an explicit
  `null`, a non-integer, `< 1`, or a numeric _string_ are all refused. The
  string case matters: reading the field through the existing
  `Partial<LockedRepresentation>` cast would coerce it, making `'2' > 1` true
  and `'0.5' > 1` false — right answers for the wrong reason.
- `libVersion` is now `LIB_VERSION` (`0.0.21`) rather than the literal
  `'0.0.1'`, and `FavaLib.version` reads the same constant. It is kept
  deliberately, as the **informational** record of which build last wrote a
  blob; `tests/utils/creationUtils.test.mts` pins that it never gates a load.
  `tests/version.test.mts` fails if `package.json` is bumped without it.
- The sync side: `SyncCommand` now declares the `version` and `timestamp` it has
  always carried on the wire, and `CommandManager.receiveRemoteCommand` drops a
  command whose major version is newer than `COMMAND_VERSION`. It **drops with a
  warning rather than throwing** — `SyncManager.receiveCommands` calls it inside
  a `Promise.all`, so a throw would abort the whole batch. This is lossless: the
  command is never reported in `syncCommandsExecuted`, so the server redelivers
  it after an upgrade (`server.mts:42-50`). A `droppedCommandIds` set keeps the
  warning to once per command per session, since redelivery happens on every
  reconnect. Note this changes no behaviour today: every command in existence
  carries the literal `'1.0'`, because all six concrete commands forward a
  `version?: string` they are never given. It is a forward-compat hook only.
- `tests/fixtures/vault-v1.json` — a frozen, real v1 vault, the regression gate
  item 2 of [06](06-crypto-test-coverage.md) asks for. Its expected OTPs were
  cross-checked against an independent RFC 6238 implementation, so it pins
  argon2id → RSA-OAEP → AES-CBC → TOTP as genuinely correct rather than merely
  self-consistent, on both the node and browser providers. No generator script
  is checked in, on purpose — see `tests/fixtures/README.md`.

Verified by mutation: disabling the version comparison reddens three tests in
`creationUtils.test.mts`, disabling the command gate reddens two in
`SyncManager.test.mts`, and changing `iterations` from 256 to 255 reddens the
fixture.

**Left open deliberately, now closed:** the bare `JSON.parse` at the top of
`loadFavaLibFromLockedRepesentation` threw a raw `SyntaxError` on a truncated
file rather than an `InitializationError`. That belonged to
[05](05-load-path-validation.md), which owns the envelope validation, and was
untouched here. `05` landed 2026-09-17 and wraps both parses.

### Amendment: the pairing payload was the third unversioned surface

This file versioned two surfaces and stopped there: the stored envelope
(`STORAGE_VERSION`) and the sync command (`COMMAND_VERSION`). The add-device
pairing payload — the JSON behind the QR code or connection string, produced by
`SyncManager.initiateAddDeviceFlow` and consumed by `respondToAddDeviceFlow` —
carried no version at all, and nothing in this review noticed. It is not a
finding anyone filed; it surfaced when `jpake-ts` went to 2.0.

It matters because that payload is the one wire in the system handed across
**versions** by construction: the whole point of pairing is that a device that
has never met this build reads it. And the JPAKE format underneath it is not
backward compatible — jpake-ts 2 binds each Schnorr proof to its generator and
hashes the session key over a transcript, so a 1.x peer's pass 1 is rejected and
a matching key would not be reached anyway. Without a version field, that showed
up three messages later as `SyncError('Error processing initiator pass 1')`,
which reads as a corrupt QR code rather than an out-of-date device.

Resolved alongside the jpake-ts 2.0 upgrade:

- `PAIRING_VERSION` in `src/version.mts`, currently `'2.0'`, whose major tracks
  the JPAKE wire format. `InitiateAddDeviceFlowResult` now carries it as
  `pairingVersion` and `initiateAddDeviceFlow` stamps it.
- `assertPairingVersionIsSupported` in `SyncManager.mts` runs before any other
  validation of initiator data and throws `SyncPairingVersionError`, named so a
  UI can say which of the two devices is the one to update. A payload with no
  `pairingVersion` counts as major 1 — a build on jpake-ts 1.x.
- The gate differs from `commandVersionIsSupported` in both directions: an
  **exact** major match, and a throw rather than a dropped message. There is no
  "older is fine" case for a key exchange that cannot complete, and no queue to
  redeliver from — the user is standing in front of both devices.

Verified by mutation: disabling the gate reddens three tests in the new
`SyncManager.test.mts > pairing version` block, and dropping the field from the
emitted payload reddens twelve — every test that pairs two devices.

The PWA showed none of this. `ConnectToExistingVault` submitted with
`void respondWithName(...)`, so every pairing failure — this one, an unreadable
QR code, a missing server connection — resolved to an unhandled rejection and
the screen simply did nothing. It now reports `err.message`, which is why the
library writes these messages for the person holding the two devices rather
than for a log. Covered by `app-browser/e2e/pairing-errors.spec.ts`; reverting
the component fails those three specs twice over, once on the missing message
and once on the shared fixture's uncaught-error check.

**Known asymmetry, not fixed:** the payload only travels initiator → responder,
so only the responder can check. A _new_ initiator meeting an _old_ responder
still gets the old three-messages-later failure, on the old device, in code this
build cannot change. Closing that would mean versioning the `JPAKEPass2` relay
too, which is a sync-protocol change and belongs with
[12](12-sync-findings-index.md).
