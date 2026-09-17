# 14 — Unvalidated sync-device injection

**Verdict:** broken — the most severe finding surfaced anywhere in this review
**Status:** open
**Priority:** unranked — belongs to the sync-protocol review ([12](12-sync-findings-index.md))
**Touches:** `src/subclasses/SyncManager.mts:824-826`, `:1021-1034`,
`src/Command/commands/AddSyncDeviceCommand.mts:56-59`

## Finding

Two independent paths add a peer device, and neither validates anything.

**Path 1 — `importVaultState`** (`SyncManager.mts:824-826`) loops
`vaultState.sync.devices` straight into `addSyncDevice`. The device list arrives
inside an unauthenticated AES-CBC blob
([02](02-ciphertext-authenticity.md)).

**Path 2 — `AddSyncDeviceCommand`**, whose validator is verified to be exactly
this:

```ts
  validate(): boolean {
    // TODO: actually validate
    return true
  }
```

And `addSyncDevice` itself (`SyncManager.mts:1021-1034`) de-dupes on `deviceId`
and pushes. Verified — there is no shape check, no PEM check, no count cap, and
no confirmation step:

```ts
  async addSyncDevice(device: SyncDevice, saveAfter = true) {
    if (this.syncDevices.some((d) => d.deviceId === device.deviceId)) {
      return
    }
    this.log('info', `Adding syncdevice ${device.deviceId} to ${this.deviceId}`)
    this.syncDevices.push({ ...device })
    ...
```

## Why this is the severe one

Combine it with [13](13-sync-command-authentication.md). Because commands carry
no sender authentication, **any party that knows device B's public key can
inject an arbitrary device record — carrying an attacker-controlled public key —
into B's `syncDevices`.**

From that point B encrypts every outgoing command to the attacker's key,
including every `AddEntryCommand`. In a TOTP client that means **every newly
enrolled seed is delivered to the attacker**, silently, with the vault
continuing to work normally.

There is no UI confirmation for a new sync device and no fingerprint the user
could compare, so nothing surfaces the injection.

Note the contrast with the pairing flow, which is done properly: adding a device
via JPAKE requires a 60-byte out-of-band secret. This path bypasses that
entirely.

## Direction (not a design)

Device enrolment needs to stay on the authenticated path. At minimum: reject
device records that did not arrive via a completed JPAKE pairing or a signed
command from an already-trusted device, pin public keys on first receipt, and
surface new devices to the user. `AddSyncDeviceCommand.validate()` needs to
actually validate.

Ordering matters — this depends on [13](13-sync-command-authentication.md), since
"a signed command from a trusted device" is not currently expressible.

## Resolution

Still **open**, but materially narrowed — read the two amendments below in
order.

[05](05-load-path-validation.md) landed 2026-09-17 and took the _shape_ half of
this off the table: `SyncManager.addSyncDevice` is now the chokepoint for all
three enrolment routes and rejects a record without a usable `deviceId` or a
public-key PEM, the stored device list is capped at 64, and
`AddSyncDeviceCommand.validate()` is no longer `return true`.

[13](13-sync-command-authentication.md) landed 2026-09-17 and took the larger
half: an `AddSyncDeviceCommand` is now refused unless a device **currently in
this vault's peer list** signed it, for this recipient. The headline attack in
this file — "any party that knows device B's public key can inject an arbitrary
device record" — is closed, because knowing a public key is no longer a
credential for anything. Revocation works too: a removed device cannot inject,
because it is no longer in the list its commands would be verified against.

**What is left is the part this finding names last, and it is still open.**
Enrolment by a peer that is trusted but hostile or compromised; no key pinning
on first receipt; no confirmation that surfaces a new device to the user. A
signed command still says only "a device you trust asked for this", and for
device enrolment specifically that is not enough — which is exactly why the
Direction section above asks for all three.

**The shape gate alone changed nothing about the finding.** Every attack described here
uses a _well formed_ device record; it is the attacker's own public key, in a
valid PEM, under a plausible device id. A shape gate cannot tell that record
from a real one, because nothing authenticates who sent it. What is still
missing is exactly what the Direction section says: enrolment on the
authenticated path, key pinning on first receipt, and a visible new-device
confirmation — and [13](13-sync-command-authentication.md) before any of it.
