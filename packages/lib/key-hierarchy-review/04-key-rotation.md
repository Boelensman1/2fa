# 04 — No key rotation; `changePassword` revokes nothing

**Verdict:** weak — but far cheaper to fix than it looks
**Status:** done — except the extension half, which has no code in this tree
**Priority:** P1
**Touches:** `changePassword` in `src/subclasses/PersistentStorageManager.mts`,
`src/utils/creationUtils.mts` (`generateSalt`), `src/FavaLibEvent.mts`

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
  [12](12-sync-findings-index.md)), so full revocation still means
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
[12](12-sync-findings-index.md) territory.

## How to verify

Note there is no CLI flow to drive this with: **no app package calls
`changePassword` at all** — the CLI's `vault restore-password` re-stores the
keytar entry and explicitly does not re-encrypt anything. Verification is the
library suite.

The properties to hold are: the stored `salt` changed; the symmetric key
recovered from the new envelope differs from the retained one; the retained key
no longer decrypts what the vault writes after the change; and the blob still
opens end-to-end under the new password and not the old.

The pre-existing test asserted old-fails / new-works but reused one module-scope
`salt` variable throughout, so it could not observe any of this.

## Resolution

Done 2026-09-17. `changePassword` now draws a fresh salt and a fresh symmetric
key, wraps the retained private key and the **new** symmetric key under the new
password, and installs both in one swap before saving. The vault state needs no
explicit re-encryption step: `getEncryptedVaultState` always encrypts from
plaintext, so the save that follows the swap writes the state under the new key
with an AAD built from the new salt.

What landed, beyond the ~20 lines the finding budgeted:

- **`generateSalt` in `creationUtils.mts`**, shared with the v1 re-wrap that
  previously drew its salt inline. A salt length is a security parameter and
  this review has already been bitten by a constant differing between two paths
  (the 12-vs-16-byte nonce in [09](09-iv-handling.md)). Deliberately **not** a
  `CryptoLib` method: that interface is public API and consumers may supply
  their own provider, so a new required member is a break for them, and there is
  nothing platform-specific above the `getRandomBytes` it already has.
- **`replaceKeyMaterial` takes one `VaultKeyMaterial` object** of six values
  rather than five positional arguments, and is now `private`. The object form
  is what makes the rollback below symmetric — `snapshotKeyMaterial()` returns
  the same type, so restoring is not a six-argument call reassembled by hand,
  which is the "half a swap" its own doc warns about. It was reachable from
  outside through the public `favaLib.storage.persistentStorage` getter, where
  an inconsistent swap produces a permanently unopenable vault; an outside
  caller cannot construct a consistent generation anyway, since a matching
  `encryptedSymmetricKey` needs the private key.
- **The old generation is put back if the save fails.** Without it the caller
  sees a rejection — and tells the user their password is unchanged — while the
  instance holds the new material, so the next autosave (an entry added, a sync
  command, a device removed) commits a password nobody was given. That is a
  lockout with no recovery path, because the old `encryptedPrivateKey` is gone.
  With the rollback, the worst case is a save function that wrote and _then_
  threw, which degrades to a silent revert: the old password still opens the
  vault. Revert is recoverable, lockout is not. The CLI's save function writes
  `.tmp` and renames, so a throw there really does mean the old blob is intact.
- **`getLockedRepresentation` snapshots the key material once**, and builds the
  AAD, the ciphertext, the MAC fields and the MAC from that one generation. It
  previously read `this.*` at four points separated by `await`s, so a swap
  landing mid-save could write an envelope whose stored salt was new and whose
  AAD salt was old — which **MACs correctly** and then fails to decrypt, with
  the previous blob already overwritten. Pre-existing (`salt`, `macKey` and
  `encryptedPrivateKey` were already mutated by `changePassword`), but rotation
  multiplies the torn combinations, so it is closed here.
- **`FavaLibEvent.PasswordChanged`**, dispatched after the save and carrying an
  empty payload. This is the hook for the extension half below; a listener that
  cached credentials only needs to know they are stale, and a payload here would
  be a payload carrying secrets.

Deliberately **not** rotated: the RSA keypair. Peers hold this device's public
key and the only distribution channel is an unauthenticated
`AddSyncDeviceCommand` — [12](12-sync-findings-index.md) territory. Full
revocation still means re-pairing devices.

Nothing on the sync path moved, as the finding predicted. Verified rather than
assumed: the handshake passes an explicit JPAKE-derived key, `resilver` mints a
fresh key per destination device, and commands use a per-command ephemeral, so
`key ?? this.symmetricKey` never falls through to the at-rest DEK. Exports are
OpenPGP under a user-supplied passphrase, untouched.

### Still open — the extension half

"Also clear the extension's session password on a password change" is **not
actionable in this tree**: `VaultContainer.ts` lives only on the
`app-extension` branch, and no app package calls `changePassword` at all. The
`PasswordChanged` event is the bridge — that branch hooks it and clears
`browser.storage.session`'s `vaultPassword`, the same call its `lock()` already
makes. Tracked next to [07](07-session-key-api.md), which owns the storage
choice itself.

[07](07-session-key-api.md)'s library half landed 2026-09-17, which changes
what this hook has to clear and why. That store now holds an exported session
blob rather than the password, and a blob predating a password change is
**refused** by the envelope MAC — keyed from the password hash, which this
finding's rotation moves — rather than silently used. So clearing on
`PasswordChanged` is now hygiene: it removes live key material that still opens
a _stale_ copy of the vault ([18](18-anti-rollback.md)), instead of being the
only thing between a stale credential and a wrong unlock. Still worth doing,
for a smaller reason.

### Two follow-ups this work surfaced

- ~~**The v1 migration re-wraps the legacy symmetric key rather than rotating
  it**~~ — **moot as of 2026-09-17.** It was fixed in passing when the migration
  started calling `createKeys`, which mints a whole fresh generation, and then
  became unreachable when the v1 read path was deleted outright
  ([18](18-anti-rollback.md)).
- **`save()` silently no-ops without a save function**, so `changePassword` on
  a read-only instance rotates in memory and evaporates with no error. Harmless
  before rotation, since the in-memory and on-disk keys at least still agreed.

## Amendment: "the RSA keypair" is now two curve keypairs, and nothing else moves

[13](13-sync-command-authentication.md) replaced the asymmetric layer on
2026-09-17 — X25519 for key agreement, Ed25519 for signatures — which changes
the wording of this finding's standing decision but not the decision itself.

- **`changePassword` still rotates the salt and the symmetric key, and not the
  keypairs.** The reason is unchanged: peers hold the public halves, and the
  only channel for new ones is a pairing flow. Full revocation is still a
  re-pair.
- **What a password change re-seals is different, and simpler.** Both secret
  keys are sealed as one AES-GCM envelope under an HKDF-derived key, so
  `encryptKeys` no longer re-wraps a PBES2 PEM and no longer wraps the symmetric
  key to a public key at all.
- **Revocation of a REMOVED device is now real**, which this finding did not
  claim and could not have. `removeSyncDevice` used to splice an array while the
  removed device kept every peer's public key; commands are verified against the
  device list now, so removal takes effect immediately for anything that device
  tries to say. Its ability to _read_ what it already had is unchanged — that is
  what re-pairing and a fresh symmetric key are for.
- **One new case.** Migrating a v1 vault mints a fresh keypair, because an RSA
  one cannot be carried across. That is the only path in the library that
  replaces a device's identity keys, and the user is told about it.
