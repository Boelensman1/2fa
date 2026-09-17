# 14 — Unvalidated sync-device injection

**Verdict:** broken — the most severe finding surfaced anywhere in this review
**Status:** done — closed 2026-09-17; the last part was **decided**, not built,
and the decision is the amendment at the bottom
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

## Amendment: closed 2026-09-17 — flat peer trust, stated and instrumented

Everything above this line still reads as it did when it was written. What
follows is the decision that closed it, and it does **not** do what the Direction
section asks for. It argues that one third of that ask was the wrong thing to
build.

### The decision: a peer is a peer

**Peer trust is flat, and that is now written down** ([11](11-threat-model.md)'s
"Not defended" list) rather than merely true.

The case for it: every device runs its own `createKeys` and holds the whole
decrypted vault. A compromised peer already has every seed. `AddEntry`,
`DeleteEntry` and `UpdateEntry` act on data it holds anyway, so refusing them
would protect nothing — and the same is true of a hostile peer reading the vault
it legitimately received.

The case against it is the one this file makes, and it is real: **`AddSyncDevice`
is not a data operation.** It acts on trust, and trust composes in ways data does
not. An injected device outlives revocation of whoever injected it — remove the
compromised peer and the device it enrolled stays, in every remaining peer's
list, receiving every future `AddEntryCommand` through `sendCommand`'s loop over
`syncDevices`. It recurses: that device can enrol another. And nobody ever
established that pair — a JPAKE pairing means the user stood in front of two
devices holding a 60-byte out-of-band secret, and the mesh silently converts
"the user paired A and C" into "B trusts C", on A's say-so, which a compromised
A gives exactly as convincingly as the user does.

**The gate was designed and rejected.** Quarantining a peer-introduced device
until the user approves it closes the finding as written. It was not built, for
two reasons:

- **It fails silently, in the honest case.** A pending device is not a sealing
  target, so entries added on one device stop reaching it and the two vaults
  drift apart while both look fine. That failure is more likely than the attack
  and much harder to notice — the opposite of the trade
  [05](05-load-path-validation.md) made when it chose to refuse rather than drop.
- **The confirmation would mostly be theatre.** It is only worth anything if the
  user compares a fingerprint against the other device, which means walking to
  it. A dialog that is always answered "yes" has not added a decision, only a
  click, and a security property that rests on a click nobody reads is the same
  kind of undeclared assumption [13](13-sync-command-authentication.md) argues
  against in its point 1.

So the library does not gate enrolment. It makes it **legible**: every
peer-introduced device records who introduced it, carries a fingerprint the
introducing peer did not choose, and announces itself. Acknowledgement is
informational and **gates nothing** — it exists so a consumer can tell what it
has not shown the user yet.

Two of the Direction's three asks were built anyway, because they are cheap and
correct under any trust model: **keys are pinned on first receipt**, and
**enrolment is surfaced**. The third — keeping enrolment off the delegated path —
is the one this decision declines.

### And three things that contradicted even the flat model

A flat model still has to be self-consistent. These were not:

- **Removal did not converge.** `removeSyncDevice` spliced an array. A peer
  offline at the time still listed the device, and its next resilver put it
  straight back through `importVaultState` — at which point its commands
  verified again. The one remediation lever the user has quietly did nothing.
  This is a correctness bug before it is a security one, and it is the item here
  that most deserved fixing.
- **Keys were pinned by accident, and silently.** `addSyncDevice` returned early
  on a duplicate `deviceId`, so a record carrying _different_ keys for a known
  device was discarded with no log, no error, nothing. The pinning was real; the
  silence meant an attempt to displace a device's key was indistinguishable from
  a no-op.
- **Any peer could rename any device.** `ChangeDeviceInfoCommand.validate()`
  returned `true` unconditionally when `fromRemote` — "we can only validate this
  command locally" — which also skipped the 1–256 length bound entirely on that
  path. The friendly name is what a user reads when deciding whether a device
  belongs, so a peer that can write someone else's name can dress its own device
  as the user's phone. That is exactly why a fingerprint is worth having, and
  why this is fixed in the same change.

### What landed

- **Enrolment route as a required argument.** `addSyncDevice(device, via, by?,
saveAfter?)`, where `via` is `'self' | 'pairing' | 'peer'`. Required rather
  than defaulted, for the reason `getEncryptedVaultState` requires its `aad`: a
  default makes the wrong one the easy one to reach for. The discriminator for a
  command is exact and needed no new plumbing — this device only ever _creates_
  an `AddSyncDeviceCommand` at the end of a pairing flow it took part in, so
  `fromRemote` is the whole test.
- **Both enrolment routes, not just the command.** `importVaultState` loops a
  peer's whole device list into `addSyncDevice`, on the resilver path and on the
  pairing responder's initial vault. It takes the route too: on an initial
  vault the sender's own record is a `'pairing'`, since the responder just
  completed JPAKE with it; everything else in that list is a `'peer'`
  introduction however the sender itself arrived.
- **Provenance is local and unwritable by its subject.** `addSyncDevice` builds
  the stored record field by field from the four wire fields rather than
  spreading the incoming one, so an `enrolment` or `acknowledgedAt` arriving
  from a peer is ignored. A peer does not get to claim its introduction was a
  pairing, or to pre-acknowledge itself.
- **A fingerprint, and why it is that long.**
  `utils/deviceFingerprint.mts` digests `(deviceId, publicKey,
signingPublicKey)` through the same length-prefixed encoder the AADs use, and
  renders 12 bytes as six hex groups. 96 bits rather than 64 because the
  adversary is grinding their own keypair to match a fingerprint a user is
  reading off another screen — a second preimage on a specific target, not a
  birthday bound. It is synchronous and outside `CryptoLib` on purpose: a digest
  of values that are public by definition, with no key, called from render
  paths. `@noble/hashes` is already a direct dependency and already the hash
  both providers agree through.
- **`SyncDeviceAdded`, and a log beside it.** The event fires only for
  `via: 'peer'`. A device this vault paired with itself, or registered as
  itself, is an act the user performed in person at both ends; re-asking would
  be noise, and noise is what stops the one that matters being read. It is
  logged as well as dispatched so that a consumer with no listener for the new
  event still surfaces it — at `warning`, not `error`:
  [Events.mts](../src/interfaces/Events.mts) reserves `error` for a **refusal**
  the user should be told about, and nothing is refused here. Under flat peer
  trust this is an ordinary thing that happened. The two refusals this change
  does add — a reintroduced removed device, and a key conflict — are `error`,
  which is what that severity is for.
- **Tombstones.** `VaultSyncState.removedDevices` is `Record<DeviceId, number>`,
  shaped like `15`'s `replayFloors`. A tombstone blocks _introduction_, never
  pairing: re-pairing clears it, because that is the user saying so at both ends
  with the out-of-band secret, and without that "I removed it by mistake" would
  be unrecoverable. Only a device actually present is tombstoned, so a peer
  cannot inflate the record with removals for ids this vault never held.
  `setSyncServerUrl` carries the record across, where it deliberately does not
  carry the device list — otherwise changing sync server would be a way to
  un-remove a device.
- **The tombstone cap is loose, and loud.** `MAX_REMOVED_DEVICES = 256`, four
  times the device cap. Pruning here **weakens** the record, unlike `15`'s
  floors, where pruning an id raises a floor and never makes anything acceptable
  again — device ids are not ordered, so a dropped tombstone leaves nothing
  behind that still refuses. It is bounded at all for the reason
  `MAX_SYNC_DEVICES` exists: the record is re-serialised and re-encrypted on
  every save.
- **Key conflicts refuse rather than drop.** Same keys is still an idempotent
  no-op — every resilver replays the whole device list, so that is the common
  case. Different keys throws `SyncDeviceKeyConflictError` and logs at `error`.
  Its own error type because it is the one sync refusal that is _evidence_:
  every other one describes a peer on a different build or a malformed record.
- **`removeSyncDevice` refuses to remove this device.** The guard existed in
  `FavaLib.removeSyncDevice`, which covers only the local route; a peer's
  `RemoveSyncDeviceCommand` reaches `SyncManager` directly. This device's own
  record is inert on every path except one — it is what a newly paired device
  learns this device's keys from — so losing it presents, much later, as
  "pairing is broken" rather than as anything to do with the removal.
- **The verified sender reaches the command.** `BaseCommand.fromDeviceId` is set
  only by `fromJSON`, from the id `verifyCommandEnvelope` matched a signature
  against, and is deliberately **absent from `toJSON`**: it is this device's
  conclusion about who spoke, not a field of the command. `ChangeDeviceInfo`
  now requires it to equal the device being renamed, and the length bounds apply
  on both paths.
- **The load path refuses, as it does everywhere else in `05`.** A malformed
  `removedDevices` record, or one over the cap, is refused rather than reset —
  a vault that has quietly forgotten what it revoked works perfectly and accepts
  a device the user removed. So is a vault that both lists and tombstones a
  device: this library cannot write that, so it is a vault edited from outside,
  and resolving it in favour of the device list would discard a revocation.
- **No wire change, no server change, no version bump.** Nothing new crosses the
  wire: the new fields are local opinion, written here and ignored on receipt,
  and `AddSyncDeviceData` is unchanged. The server was not touched and its suite
  passes unedited, which was `13`'s design goal and stays true.
- **Additive for consumers.** `getSyncDevices()` is still synchronous and gained
  three fields, so `favabrowser` and `favacli` compile untouched. One thing did
  have to change shape: `PublicSyncDevice` is a `type` rather than an
  `interface`, because an interface has no implicit index signature and so does
  not satisfy `type-fest`'s `Jsonifiable`, which is what `favacli` declares its
  command output as. The old `Omit<...>` alias satisfied it by accident, being
  an intersection; it now says so on purpose, with the lint rule disabled and
  the reason written at the type.

### Verified by mutation

| Mutation                                        | Result                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| let a peer reintroduce a removed device         | 2 red: the tombstone case, and the end-to-end `AddSyncDevice` one                                               |
| stop writing tombstones at all                  | 3 red: those two, plus the pruning case                                                                         |
| overwrite on a key conflict instead of refusing | 2 red: the pinning case, at the manager and end to end                                                          |
| drop the self-removal guard                     | 1 red                                                                                                           |
| wave a remote `ChangeDeviceInfo` through        | 3 red: renaming another device, renaming this device, and a remote rename with no verified sender               |
| stop dispatching `SyncDeviceAdded`              | 1 red                                                                                                           |
| take `enrolment` from the record the peer sent  | 2 red: the forged-provenance case, and the full pairing flow — the responder would file the initiator as `self` |
| never clear a tombstone on re-pairing           | 1 red: the re-pairing case                                                                                      |

The `enrolment` row is there because the first attempt at it reddened
**nothing**: the mutation spread the incoming record _before_ the explicit
fields, so it changed nothing, and the test that should have caught a real
version of it did not exist.
Both were fixed — a forged `enrolment`/`acknowledgedAt` on the wire is now
asserted against directly.

### What this does NOT do

Stated plainly, because the decision above is only honest if its cost is:

- **A trusted peer can still enrol whatever it likes.** That is the finding's
  headline remnant, and it is now in-model rather than open. It can also remove
  your other devices, which is a denial of service a flat model permits.
- **Acknowledgement gates nothing.** A device is a full peer from the moment it
  is enrolled, acknowledged or not.
- **The friendly name is still attacker-chosen**, just only by the device it
  names. The fingerprint is the field that is not.
- **Nothing is surfaced to a user yet.** This is the library half only; the
  browser extension is the intended consumer of `SyncDeviceAdded` and the
  `acknowledged` flag, and there is no such code in this tree. `favabrowser`
  and `favacli` list devices without showing a fingerprint.
- **Ordering is still sender-chosen**, which is the item
  [15](15-sync-replay-protection.md) handed to this file. It closes under the
  same decision: a peer choosing the timestamps its own commands are ordered by
  is a peer acting inside its trust.
