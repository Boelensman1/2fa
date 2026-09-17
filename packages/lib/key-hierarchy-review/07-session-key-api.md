# 07 — The extension stores the raw master password

**Verdict:** untidy, with a real blast-radius cost
**Status:** done — except the extension half, which has no code in this tree
**Priority:** P2 — but it unblocks the KDF raise in [01](01-kdf-parameters.md)
**Touches:** `src/utils/creationUtils.mts`,
`src/subclasses/PersistentStorageManager.mts`,
`src/subclasses/StorageOperationsManager.mts`, `src/interfaces/Vault.mts`,
`src/version.mts`, `src/main.mts`;
`packages/app-extension/lib/ioc/entities/VaultContainer.ts` (`app-extension`
branch)

## Finding

On the `app-extension` branch, `VaultContainer.ts` persists **the raw master
password** to `browser.storage.session` under `vaultPassword`, so an unlocked
vault survives MV3 service-worker eviction. On every worker boot
`restoreSession()` replays a full `unlock()` — argon2 plus forge
`decryptRsaPrivateKey`.

The author already identified the cause, in the file's own doc comment:

> favalib can only build a `FavaLib` from `(lockedRepresentation, password)` --
> there is no api to rehydrate one from the keys it has already derived. An mv3
> service worker is evicted after ~30s idle, taking the instance with it. So the
> only way to stay unlocked across an eviction is to keep the password. […] The
> clean fix is an "export/import unlocked session" api in favalib, which would
> let this hold derived key material with a lifetime of its own instead.

That is correct, and it has two consequences beyond tidiness:

1. **Blast radius.** A compromise of `browser.storage.session` yields the
   password itself, not just this device's derived keys. The password is the
   input for _every_ device, and users reuse passwords. Leaking derived keys
   would be strictly less bad.
2. **It is the only real argument for a cheap KDF.** Because unlock runs on
   every worker boot rather than once per session, raising the argon2 cost
   ([01](01-kdf-parameters.md)) is felt repeatedly. Fix this and that objection
   disappears.

Mitigations already in place, worth keeping: `browser.storage.session` is
memory-backed and unreadable from content scripts; MV2 builds (Firefox,
persistent background page) never write it at all
(`backgroundCanBeEvicted()`); and `lock()` clears it.

Gap: `changePassword` does **not** clear it, so a stale password can outlive the
change (see [04](04-key-rotation.md)).

## What to do

Add an export/import-unlocked-session API to `favalib`: serialise the derived
`privateKey` / `symmetricKey` / `salt` / meta into an opaque blob, and rehydrate
a `FavaLib` from it without a password. The extension then stores that instead
of the password.

Note this is **new public API on a published package** — `favalib` is published
to npm, so the surface is a commitment. Design it deliberately.

The extension's tests currently assert on the storage key directly (e.g.
`expect(store.has('session:vaultPassword')).toBe(false)` in
`tests/vault/VaultContainer.test.ts`), so the _fact_ that the password is the
stored artifact is pinned by tests today. Those change with this work.

## How to verify

Evict the worker (or simulate it) and confirm the vault re-attaches with no
argon2 run and no password in session storage. Confirm MV2 behaviour is
unchanged. Confirm `changePassword` invalidates the stored session blob.

## Resolution

Done 2026-09-17, library half only. `favalib` now exports an unlocked session:
`favaLib.storage.exportUnlockedSession()` returns the derived key material as
an opaque string, and `loadFavaLibFromUnlockedSession(lockedRepresentation,
session)` rehydrates a `FavaLib` from it with **no password and no key
derivation** — no argon2id, no PBES2 unwrap of the private key.

### What landed

- **The blob carries only what a password unlock _derives_**: `privateKey`,
  `publicKey`, `symmetricKey`, `macKey`, plus a `sessionVersion`. Everything a
  vault stores about itself — the salt, the kdf block, both encrypted keys, the
  encrypted vault state — is read from the `LockedRepresentation` the consumer
  already holds. Duplicating any of it would create two copies of one fact that
  can disagree; reading it from the stored vault makes disagreement
  unrepresentable rather than merely unlikely. `tests/unlocked-session.test.mts`
  asserts the exact key set, because adding a field is cryptographically inert
  and nothing else would catch it.
- **Staleness is refused cryptographically, with no new state.** Import runs
  the same `verifyEnvelopeMac` the password path runs. The MAC key is derived
  from the password hash, so [04](04-key-rotation.md)'s rotation of the salt,
  the symmetric key and the MAC key means a pre-change session simply fails
  against the vault that change wrote. No epoch counter, nothing to remember to
  increment, and the check is the one that was already there.
- **The binding is to a key _generation_, not to a blob.** A save moves none of
  the fields the MAC is keyed for, so one session opens every envelope that
  generation goes on to write. Stated explicitly and tested, because the
  obvious wrong reading — re-export after every save — would write key material
  to storage on every keystroke.
- **A storage version 1 vault is refused on this path**, for two independent
  reasons. A v1 envelope carries no `envelopeMac`, so there is nothing to check
  the session against; and opening a v1 vault _re-wraps_ it, which needs the
  password. The session path could not migrate a vault even if reading one were
  safe. This also keeps the rule `decryptKeysV1` and `decryptSymmetricV1`
  document — the legacy crypto still has exactly one caller.
- **One uniform error for "wrong vault", "stale" and "tampered".** A session
  import that distinguished them would tell whoever can write the session store
  which of their guesses was closest. `CryptoLib.decryptSymmetric` already takes
  that position one layer down. The class is `CryptoError` in all three cases,
  so a consumer branches on "session unusable" and nothing finer.
- **`CryptoError` is now exported from `main.mts`.** It has always been the
  class thrown to consumers by the existing load path — `'Invalid password'`
  from both providers and the integrity error from `creationUtils` — and was
  never exported, so the extension carries an `/invalid password/i` regex over
  `error.message` today. This path makes that gap acute, because "the session no
  longer fits, prompt for the password" is a routine and recoverable outcome a
  consumer must branch on. Closing a pre-existing hole, not opening a surface.
- **`SESSION_VERSION`, deliberately not `STORAGE_VERSION`.** The two version
  artifacts with opposite obligations: a stored vault must open forever, and a
  bump there drags in a frozen fixture, a read path and a migration; a session
  is memory-backed, never migrated, and the right answer to an unrecognised one
  is one password prompt. Compared with `!==` rather than `<` — an older blob
  means the process was upgraded under a live session, a newer one means a
  downgrade, and neither is a shape to guess at.
- **`publicKey` moved into `PersistentStorageManager`'s constructor.** The
  export needs it, and the mutable material it must be read beside —
  `symmetricKey` and `macKey` — lives only there; `FavaLib` hands everything but
  the two immutable keys away. Deliberately **not** added to `VaultKeyMaterial`
  or to `snapshotKeyMaterial`/`replaceKeyMaterial`: it is not rotated, and
  putting it in the unit those move would imply it is.
- **The load path was split into six named helpers** —
  `readStorageVersion`, `requireCompleteLockedRepresentation`,
  `requireV2EnvelopeFields`, `decryptV2VaultState`, `parseVaultState`,
  `constructFavaLib` — landed as a separate, verified-green refactor before any
  session code existed. `decryptV2VaultState` is the load-bearing one: the MAC
  verify and the AAD-bound decrypt live in one function with no way to do one
  without the other, and both v2 paths go through it. That is stronger than a
  shared tail, which a third caller can bypass.

Deliberately **not** encrypted. Wrapping the blob needs a key held somewhere
with a different lifetime, and on the platform this exists for there is none —
a key in the same process, the same storage area, or derived from the password
we are trying not to store is held by exactly the attacker this would defend
against. The wrap would buy the _appearance_ of protection, which is worse than
its absence because it invites storing the blob somewhere weaker. The
protection is a storage contract instead, stated as one in the JSDoc:
memory-backed storage with the lifetime of a process, and nothing else.

Deliberately **not** a new `CryptoLib` member. That interface is public API and
a consumer may supply their own provider, so a new required member is a break
for them — the same argument `generateSalt` records in `creationUtils.mts`.
Nothing here needs a new primitive: the path composes `sha256`,
`verifyEnvelopeMac` and `decryptSymmetric`, all already pinned per provider by
`tests/CryptoProviders/`. That is also why this work adds no file there.

### What this does NOT do

**It is not freshness, and it is not confidentiality.**

- A stale session paired with the stale `LockedRepresentation` it was exported
  beside **opens cleanly** — both were valid together. The MAC proves the two
  belong to one generation; it cannot prove either is current. That is
  [18](18-anti-rollback.md), and it is why 04's extension half still matters:
  clearing the blob on `PasswordChanged` removes live key material, which a
  refusal at import time does not.
- The blob is plaintext. Whoever reads it reads this vault. What the change buys
  is that they no longer read the _password_, which is the input for every other
  device and — because users reuse passwords — for things that are not this
  vault at all.
- An attacker who can **write** the session store gains nothing new: they would
  have to write a matching `LockedRepresentation` too, at which point they are
  handing the extension a vault of their own, which they could already do.

### Verified by mutation

| Mutation                                                      | Result                                                                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| drop the `verifyEnvelopeMac` check from `decryptV2VaultState` | 5 red across **both** files — `envelope-integrity.test.mts` and the session tests. That the password path reddens is the proof the chokepoint is genuinely shared rather than copied |
| drop the `storageVersion < STORAGE_VERSION` refusal           | `'refuses a storage version 1 vault…'` and `'refuses a v1 vault whose migration could not be persisted'` red, alone                                                                  |
| parse the session blob before gating the stored vault         | `'refuses a storage version 1 vault, before it looks at the session'` red **alone** — the ordering is pinned, not just the outcome                                                   |
| put `salt` into the exported blob                             | `'carries only the four derived secrets'` red, alone. Cryptographically inert, which is exactly why that test exists                                                                 |
| export a wrong-but-present `publicKey`                        | `'hands the sync manager the same public key the password path does'` red, alone — the only test that motivates the field at all                                                     |
| compare `sessionVersion` with `<` instead of `!==`            | 4 red, including `'refuses sessionVersion 2'`                                                                                                                                        |
| change `SESSION_VERSION` to track `STORAGE_VERSION`           | **nothing red.** Recorded because a test cannot catch a coupling decision; the JSDoc at the constant is what carries it                                                              |

Each was reverted afterwards.

Worth noting what the MAC mutation did **not** redden: the staleness and
wrong-vault tests stayed green, because the GCM layer catches those too — the
symmetric key and the AAD's salt both move on a password change. Two
independent layers, which is the intent, but it means the MAC check is not
solely load-bearing for those cases.

### Still open — the extension half

Not actionable in this tree. `VaultContainer.ts` lives only on the
`app-extension` branch, which is eleven commits behind `main` and predates the
whole `storageVersion: 2` body of work — switching it over means merging that
branch first.

What that branch does, once merged: `attach()` (its single write point for
`session:vaultPassword`) stores `favaLib.storage.exportUnlockedSession()`
instead of the password; `restoreSession()` calls
`loadFavaLibFromUnlockedSession` and keeps its existing catch, which already
falls back to `lock()` on any failure; `lock()` clears the blob as it clears
the password today; and a `FavaLibEvent.PasswordChanged` listener clears it too
— which is [04](04-key-rotation.md)'s open extension item, the same one-line
hook, so the two findings are one commit on that branch. MV2 builds still write
nothing (`backgroundCanBeEvicted()`).

Its tests change shape exactly as this finding predicted above: the
`expect(store.has('session:vaultPassword')).toBe(false)` assertions become
assertions about the session blob.
