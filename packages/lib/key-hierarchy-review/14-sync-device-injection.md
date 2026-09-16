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

_Not started._
