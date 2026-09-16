# 17 — `createSyncKey`'s salt is a public device id

**Verdict:** untidy — no exploit, but it is not a salt
**Status:** open
**Priority:** P3 — cosmetic; fix when the sync review touches this code
**Touches:** `src/subclasses/SyncManager.mts:666`, `:698`

## Finding

Both `createSyncKey` call sites pass the responder's `deviceId` as the argon2
salt — verified at `SyncManager.mts:666` and `:698`:

```ts
const syncKey = await this.cryptoLib.createSyncKey(
  sharedKey,
  responderDeviceId as string as Salt,
)
```

Note the `as string as Salt` double cast, which is the type system being talked
out of the objection rather than agreeing.

That value is public, server-visible, and **reused across every pairing with
that device** — three properties a salt is specifically supposed not to have.

## Why it is nonetheless harmless here

The input is `jpak.deriveSharedKey()`, a ~256-bit secret from the JPAKE
exchange. A salt exists to stop precomputation against _low-entropy_ inputs;
against a 256-bit key there is nothing to precompute. The weak argon2
parameters flagged in [01](01-kdf-parameters.md) are immaterial on this path for
the same reason.

So this is a design smell, not a vulnerability, and it should be recorded as
such rather than inflated. The reason it is worth a file at all: it reads as if
someone believed a salt was being supplied, and the next person to touch
`createSyncKey` may assume the same and reuse the pattern where the input _is_
low-entropy.

## Direction

Use a fresh random salt per pairing, transmitted alongside the JPAKE exchange —
or, if the derivation genuinely needs to be reproducible from public values on
both sides without extra messages, keep the device id and **say so in a comment**
so the choice reads as deliberate.

Drop the `as string as Salt` cast either way.

## Resolution

_Not started._
