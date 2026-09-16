# 05 — The load path skips the entry validators that already exist

**Verdict:** weak
**Status:** open
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
`creationUtils.mts:193-208` and `importVaultState`. **Drop-and-log rather than
throw**, matching the policy already stated in `entryValidation.mts:69-74`:
`CommandManager.processRemoteCommands` drops a failing remote command and never
retries it, so a strict check would lose the entry permanently.

Validate `sync.devices` shape before `addSyncDevice`, and cap the count.

Wrap the outer `JSON.parse` so a corrupt file surfaces as `InitializationError`.

~15 lines. No format change, no migration.

## How to verify

Hand-craft a vault state containing one valid entry and one malformed entry;
confirm the vault opens with the valid entry and logs the dropped one.

## Resolution

_Not started._
