# 18 — Rollback to an earlier vault is still undetectable

**Verdict:** weak — the part of [02](02-ciphertext-authenticity.md) that the
AEAD could not close
**Status:** open
**Priority:** P1
**Touches:** `app-cli/src/utils/loadVault.mts:22-47`, `src/version.mts`
(`LEGACY_STORAGE_VERSION`), `src/utils/creationUtils.mts`

## Finding

[02](02-ciphertext-authenticity.md) said the AAD binding was "what actually
stops the `vault.json.backup` swap". **It is not, and neither is the envelope
MAC that shipped with it.** Both are functions of the stored envelope, and a
backup is a previously valid envelope: same `salt`, same `storageVersion`, same
`kdf`, same MAC key. Everything verifies, because everything did verify when
that file was written.

No authenticator over a single file can detect this. Distinguishing "the current
vault" from "a vault this device wrote last Tuesday" needs state the attacker
cannot also roll back — a monotonic counter somewhere other than the file.

Two variants, and the second is the wider one:

### Same-version rollback

Copy `vault.json.backup` over `vault.json` and the vault silently reverts:
deleted TOTP seeds come back, newly added ones vanish. The CLI writes a backup
on **every** save and never removed one; as of `02` it at least deletes it on
`vault vault delete`, so an explicitly deleted vault no longer leaves a readable
copy behind. That reduces the exposure. It does not close it — the backup exists
for the entire life of the vault, which is the point of it.

The PWA keeps no backup (`app-browser`'s `localStorage` key
`lockedRepresentation` is overwritten in place), so this is a CLI-shaped problem
today. It is not a CLI-only problem: any storage the user can snapshot — a
filesystem snapshot, a synced folder, a backup tool — is the same primitive.

### Downgrade-then-migrate, while the v1 read path exists

**Wider, and it needs no matching salt or `kdf` block at all.** A v1 blob
dropped over a v2 vault opens: `loadFavaLibFromLockedRepesentation` reads it
through `decryptKeysV1`/`decryptSymmetricV1`, and then — by design — re-wraps it
to v2 and saves. The envelope MAC does not help, because a v1 blob carries none
and is not expected to.

That is the migration path working exactly as intended. It is also a downgrade
window that stays open as long as the v1 reader does. A v1 load now logs a
warning naming the upgrade, and `LEGACY_STORAGE_VERSION` carries a comment
pointing at its own removal, so the window is visible rather than forgotten.

## What to do

Two separate things, in this order:

1. **Close the downgrade window by deleting the v1 read path**, once installs
   have upgraded — `decryptKeysV1`, `decryptSymmetricV1`,
   `LEGACY_STORAGE_VERSION`, the `isLegacy` branch, and the v1 argon2 anchor in
   `kdf-vectors.test.ts` last of all. `tests/fixtures/vault-v1.json` stays
   checked in either way; at that point it becomes the fixture that proves the
   refusal is clean rather than a decryption failure. This is a calendar
   decision, not a design one.
2. **Anti-rollback proper: a monotonic counter outside the blob.** A
   `saveCounter` inside the encrypted vault state and covered by the envelope
   MAC, plus a copy in storage the attacker would have to roll back separately.
   The CLI already has a different medium available — the OS keychain, where
   the password lives (`keytar`, service `favacli`). The PWA has no equivalent
   that is not equally copyable, so for the PWA this likely has to be the sync
   server, which brings in [16](16-server-authentication.md).

Do **not** describe 1 as an anti-rollback measure. It closes one window and
leaves the other.

## How to verify

- With the CLI, `cp vault.json.backup vault.json`: the vault opens. That is the
  finding, and there is currently no assertion to add for it that would not be
  asserting a defect.
- Drop a v1 blob over a v2 vault: it opens, logs the legacy warning, and is
  re-wrapped to v2 on the next save. `tests/fixtures.test.mts` already asserts
  the re-wrap half.
- `favacli vault delete` leaves no `.backup` or `.tmp` behind.

## Resolution

_Not started._
