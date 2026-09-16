# 07 — The extension stores the raw master password

**Verdict:** untidy, with a real blast-radius cost
**Status:** open
**Priority:** P2 — but it unblocks the KDF raise in [01](01-kdf-parameters.md)
**Touches:** new public API on `favalib`;
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

_Not started._
