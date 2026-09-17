# 17 — `createSyncKey`'s salt is a public device id

**Verdict:** untidy — no exploit, but it is not a salt
**Status:** done — kept the device id, wrote down why
**Priority:** P3 — cosmetic; fix when the sync review touches this code
**Touches:** `createSyncKey` in `src/interfaces/CryptoLib.mts` and both
providers, `finishAddDeviceFlowKeyExchangeInitiator` /
`...Responder` in `src/subclasses/SyncManager.mts`

## Finding

Both `createSyncKey` call sites pass the responder's `deviceId` as the argon2
salt — verified in `finishAddDeviceFlowKeyExchangeInitiator` and
`finishAddDeviceFlowKeyExchangeResponder`:

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

Done 2026-09-17, and the finding's own "keep the device id and say so" branch is
the one that was taken. No wire change, no new field, no behaviour change — the
argon2 vector in `tests/CryptoProviders/kdf-vectors.test.ts` still pins the same
`EXPECTED_SYNC_KEY`.

### Why a real salt was rejected, and not just deferred

The Direction above offered two branches as if they were close. They are not,
and the reason is one this file did not state:

- **A fresh salt would add no uniqueness either.** The password is
  `jpak.deriveSharedKey()`, which is **ephemeral per exchange**. The derived
  `syncKey` is therefore already unique per pairing whatever goes in the salt
  slot. The "reused across every pairing with that device" line above implies
  the salt is carrying uniqueness duty; it is not, and nothing else is waiting
  for it to. Combined with the no-precomputation argument this file already
  makes, a random salt buys **zero**.
- **And it would cost something real.** A per-pairing salt is a new wire field
  routed through the untrusted sync server, arriving **before** the channel is
  authenticated. Tamper with it and the two sides derive different keys — a
  fresh DoS vector surfacing as a confusing mismatch, in exchange for the zero
  above. Compare [14](14-sync-device-injection.md) and
  [16](16-server-authentication.md) for what that server is assumed to be
  capable of.
- **The device id is mechanically fine.** It is `genUuidV4()`
  (`src/utils/creationUtils.mts`), 36 characters, so it clears argon2's 8-byte
  salt minimum, and both sides already hold it with no extra message.

So the value stays. What changed is everything that made it read like an
oversight.

### What landed

- **The parameter is typed `DeviceId`, not `Salt`**, in `CryptoLib.mts` and
  both providers, and is named `responderDeviceId`. This is the part that
  matters: the `as string as Salt` double cast at both call sites is **gone**,
  not because the cast was unsafe but because it was the type system correctly
  objecting to a claim the code should never have made. The compiler now agrees
  with what the code does.
- **The reasoning is in the interface doc comment**, where the next person
  meets it — including the explicit "do not copy this shape to a low-entropy
  password" warning. That was the actual risk this file identified: not this
  call site, but the next one.
- **The test vector's comment no longer cites line numbers.** It said
  `SyncManager.mts:664,696`; the real sites had already drifted to `849` and
  `881` by the time this was resolved, and this file's own header said `666`
  and `698`. Both now name the methods instead. Same for the header above.

### What deliberately did not change

The cost parameters on this path — `SYNC_KDF_PARAMETERS`, which
[01](01-kdf-parameters.md) left at the old numbers for the same reason the salt
is immaterial here: a 256-bit input makes the cost setting pointless. That was
already documented on `createSyncKey` and still is, now directly above the
matching argument about the salt. The two belong together, being the same
observation about the same input.
