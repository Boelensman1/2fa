# 04 — No key rotation; `changePassword` revokes nothing

**Verdict:** weak — but far cheaper to fix than it looks
**Status:** open
**Priority:** P1
**Touches:** `src/subclasses/PersistentStorageManager.mts:194-221`

## Finding

`changePassword` re-wraps the **same** `privateKey` and `symmetricKey` and
reuses `this.salt`, which is never reassigned anywhere in the class.

- **Against anyone who ever unlocked the vault, `changePassword` revokes
  nothing** — including for blobs written after the change. They hold the
  symmetric key; it encrypts every future save. Since reading anything required
  unwrapping that key, password compromise and key compromise travel together.
  Its one real benefit is narrow: someone holding a _stale copy_ of the blob and
  still grinding it does not get the new one for free.
- **Salt reuse is a real weakness, not untidiness.** `changePassword` is the
  post-compromise action. An attacker who has been grinding the old blob has
  computed `argon2id(salt, guess)` for every candidate tried; with the salt
  unchanged that entire precomputation transfers to the new blob at zero cost. A
  fresh salt invalidates all of it.
- **Rotation is much cheaper than expected.** Because the hierarchy is
  per-device (see the README), **the symmetric key is purely local** — it never
  leaves the machine and no peer has ever seen it. Rotating it needs no peer
  coordination, no protocol change and no migration. Independently-versioned
  devices are simply not a constraint here.
- **Rotating the RSA keypair _is_ expensive.** Peers hold the public key and the
  only distribution channel is an unauthenticated `AddSyncDeviceCommand` (see
  [12](12-out-of-scope-sync-findings.md)), so full revocation still means
  re-pairing devices.

**Remediation story today: none**, short of creating a new vault. Note that
re-enrolling every TOTP seed is unavoidable _once the seeds themselves have
leaked_, regardless of what the crypto does — no key hierarchy fixes that. What
rotation buys is closing the door on _future_ writes.

**Extension angle:** because `browser.storage.session` holds the raw password
rather than derived keys ([07](07-session-key-api.md)), a compromise there
yields the password itself — worse than leaking keys, since it is the input for
every device and users reuse passwords. `VaultContainer.lock()` clears it, but
`changePassword` does not, so a stale password can outlive the change.

## What to do

In `changePassword`: generate a fresh salt **and** a fresh symmetric key,
re-encrypt the vault state under the new key, then re-wrap. ~20 lines, no peer
coordination, no format change. This is the best value-per-line item in the
review.

Also clear the extension's session password on a password change.

Rotating the RSA keypair is deliberately **not** proposed here — it needs an
authenticated public-key distribution path first, which is
[12](12-out-of-scope-sync-findings.md) territory.

## How to verify

Create a vault in the CLI, run `changePassword`, and confirm the `salt` in
`vault.json` changed and that the old `encryptedVaultState` ciphertext no longer
decrypts under the retained key. The existing test at
`tests/subclasses/PersistentStorageManager.test.mts:188` asserts old-fails /
new-works but reuses the same `salt` variable throughout, so it cannot observe
this — it needs extending.

## Resolution

_Not started._
