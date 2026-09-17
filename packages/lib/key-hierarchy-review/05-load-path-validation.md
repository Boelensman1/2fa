# 05 — The load path skips the entry validators that already exist

**Verdict:** weak
**Status:** done
**Priority:** P1
**Touches:** `src/utils/creationUtils.mts:193-208`,
`src/subclasses/SyncManager.mts:804-833`, `src/utils/entryValidation.mts:75`

## Finding

`loadFavaLibFromLockedRepesentation` decrypts the vault state, `JSON.parse`s it,
and checks only that `deviceId`, `sync.commandSendQueue` and `sync.devices` are
**present**. It then passes `vaultState.vault` — the entire entry array —
unvalidated into the `FavaLib` constructor (`creationUtils.mts:224`).

The library already has the validator for exactly this:
`validateEntryFatal` (`src/utils/entryValidation.mts:75`), whose own doc comment
describes it as _"the tier applied to entries arriving from a peer"_. It is
applied in `AddEntryCommand` / `UpdateEntryCommand` / `VaultOperationsManager`
and **not** on the load path.

`SyncManager.importVaultState` (`:804-833`) is the same story, and worse:

- `vaultState.vault` → `vaultDataManager.addEntry(entry, false)`, which only
  calls `sanitiseEntry` (matchers/url/inputSelector) and never checks `type`,
  `payload`, `secret`, `algorithm`, `digits`, `period` or `id`.
- `vaultState.sync.devices` → `addSyncDevice` with **no validation at all**: no
  shape check, no PEM check, no cap on count.

The outer envelope is no better: `creationUtils.mts:175-183` is a truthiness
check behind an unchecked `as Partial<LockedRepresentation>` cast, so a number
or an object passes as `salt`. The bare `JSON.parse` also throws a raw
`SyntaxError` rather than the library's `InitializationError`.

This matters because of [02](02-ciphertext-authenticity.md): with no
authenticity on the ciphertext, a tampered blob's contents reach this code, and
this code trusts them.

## What to do

Run `validateEntryFatal` over `vaultState.vault` in both
`creationUtils.mts:193-208` and `importVaultState`, and validate `sync.devices`
before `addSyncDevice`, capping the count.

**Refuse rather than drop** — this reverses what this file said when it was
written, and the reversal is the one decision in it worth arguing about.

The original text said drop-and-log, by analogy with the policy in
`entryValidation.mts:69-74`. The analogy does not hold. That policy exists
because `CommandManager.processRemoteCommands` drops a failing remote command
and never retries it, so a strict check would lose the entry permanently — but
the command itself is _not_ lost, because the server never sees it reported as
executed and redelivers it on the next reconnect. **Nothing redelivers a vault.**
An entry dropped on the load path is gone from memory and erased from
`vault.json` by the next ordinary save. Silent, permanent loss of a TOTP seed is
a worse outcome than a loud failure.

Stated against the decision, because it is a real cost: from storage version 2
the `envelopeMac` already proves this device wrote the blob, so a malformed
entry in a v2 vault means a favalib bug or an older, laxer version — not an
attacker — and refusing locks the user out of an otherwise intact vault over the
library's own past laxity. The mitigation is the message: it names the offending
entry id and the reason, and says the data is intact, in the same register as
the `StorageVersionError` text.

The sync path keeps drop-and-log, because there the analogy _does_ hold: a
refused `AddSyncDeviceCommand` throws into `processRemoteCommands`' existing
catch, is never reported as executed, and is redelivered.

Wrap the outer `JSON.parse` so a corrupt file surfaces as `InitializationError`.

No format change, no migration.

## How to verify

Hand-craft a vault state containing one valid entry and one malformed entry;
confirm the vault opens with the valid entry and logs the dropped one.

## Resolution

Done 2026-09-17. No storage-format change and no migration: this reads the same
blob more carefully.

### What landed

- **`src/utils/syncDeviceValidation.mts`** (new) — `validateSyncDevice`, shaped
  exactly like `entryValidation.mts` (returns the reason as a string, or null),
  plus `MAX_SYNC_DEVICES = 64` and `MAX_PUBLIC_KEY_LENGTH = 4096`. It checks
  `deviceId`, that `publicKey` is a bounded string whose **trimmed** form opens
  with `-----BEGIN PUBLIC KEY-----` and closes with the matching footer, and the
  optional `deviceInfo`. Trimmed, and header/footer rather than a whole-string
  regex, because node writes PEM with `\n` and node-forge with `\r\n` — the
  same split `canonical.mts` already records. It deliberately does **not** parse
  the PEM: that would pull a platform provider into a leaf util, and this is a
  shape gate, not a key validity gate.
- **The cap counts the STORED list, self included.** `getSyncDevices()` filters
  out this device's own record, so the number a user sees tops out at 63. Both
  enforcement points count the stored list so that they agree about the same
  vault; the alternative, counting peers in one place and the raw array in the
  other, is an off-by-one waiting to happen.
- **`creationUtils.mts`** — a `parseJson` helper wraps **both** `JSON.parse`
  calls, so a truncated `vault.json` is an `InitializationError` rather than a
  bare `SyntaxError`. This closes the item [03](03-storage-versioning.md) left
  open explicitly.
- **The envelope check is now typed, not truthy.** `encryptedPrivateKey`,
  `encryptedSymmetricKey`, `salt` and `encryptedVaultState` must be non-empty
  _strings_, and a v2 `kdf` must be an object. The truthiness half is kept
  alongside the `typeof` half rather than replaced by it — it is what narrows
  away `undefined` for the code below, and a type predicate would not narrow
  through the optional chain.
- **The load path refuses**, per the reversal above: `Array.isArray` on `vault`,
  `sync.devices` and `sync.commandSendQueue`, then `validateEntryFatal` over
  every entry and `validateSyncDevice` plus the cap over every device. Placed
  after the legacy `commandSendQueue` clear, so a migrated v1 vault is judged on
  the queue it will actually carry.
- **`SyncManager.addSyncDevice` is the chokepoint** for the three routes a peer
  device arrives by — `importVaultState`, `AddSyncDeviceCommand`, and the
  constructor's own self-registration. The load path is the one route that does
  not pass through it (it assigns `syncDevices` directly), which is why
  `creationUtils` runs the same two checks itself.
- **`importVaultState`** — `Array.isArray` guards on both lists, then
  `validateEntryFatal` before `vaultDataManager.addEntry`, whose `sanitiseEntry`
  only ever repaired the three matching fields.
- **`AddSyncDeviceCommand.validate()`** was `// TODO: actually validate; return
true`. It now delegates to `validateSyncDevice` via an `invalidReason()`,
  matching how `AddEntryCommand` reports. Its `execute` also said
  `'Invalid AddEntry command'` — a copy-paste from the command it was cloned
  from — and now names itself.
- **Two `void`ed promise chains got a `.catch`.** `handleServerMessage` calls
  `importInitialVault` and `importVaultState` without awaiting either, so once
  those started throwing on malformed contents a refused import would have been
  an unhandled rejection rather than something a consumer can surface. Both now
  report through `this.log` like every other dropped-on-the-sync-path warning.

### Found by the change

`TwoFaLib.test.mts`'s mock sync manager registered a device with no
`publicKey`, so the vault it saved could not be reopened once the load path
started looking. A real `SyncManager` self-registers with one. The mock was
wrong, not the check — fixed there.

### Verified by mutation

| Mutation                                                        | Result                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| neuter the `validateEntryFatal` loop on the load path           | `'refuses a vault carrying an unusable entry, and names it'` reddens, alone |
| neuter `validateSyncDevice` and the cap in `creationUtils`      | the two device cases redden, alone                                          |
| neuter both checks in `addSyncDevice`                           | the four shape cases and the cap case redden                                |
| restore the bare `JSON.parse` and the truthiness envelope check | the truncated-file case and all four typed-field cases redden               |

The v1 and v2 frozen fixtures were checked **before** any of this landed: every
entry in both already satisfies `validateEntryFatal`, so refusing needs no v1
exemption and the migration path is untouched.

### Not closed by this

[14](14-sync-device-injection.md). A shape gate stops a garbage record; it does
nothing about a well formed one carrying an attacker's public key, because
nothing authenticates the sender of an `AddSyncDeviceCommand`. That needs
[13](13-sync-command-authentication.md) first.
