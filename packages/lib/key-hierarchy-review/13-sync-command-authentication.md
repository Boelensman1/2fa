# 13 — Sync commands have no sender authentication

**Verdict:** broken
**Status:** done
**Priority:** unranked — belongs to the sync-protocol review ([12](12-sync-findings-index.md))
**Touches:** `src/interfaces/protocol/ServerMessage.mts:30-34`,
`src/subclasses/SyncManager.mts:1009-1042`, `:1170-1210`

## Finding

`SyncCommandFromServer` carries no sender identity at all — verified:

```ts
export interface SyncCommandFromServer {
  commandId: string
  encryptedCommand: Encrypted<string>
  encryptedSymmetricKey: EncryptedSymmetricKey
}
```

The client-side `SyncCommandFromClient` does have a `deviceId`
(`ClientMessage.mts:92-97`), but it is the **recipient**, and the server does
not forward a `fromDeviceId`. So the receiving device has no idea which peer a
command claims to come from, let alone proof.

The payload offers no help either. A command is AES-CBC'd under a fresh
ephemeral key, and that key is RSA-OAEP-wrapped to the **recipient's** public
key (`SyncManager.mts:1019-1032`). RSA-OAEP is a **public** operation and there
is no signature anywhere in the repo. Every input to a well-formed
`{encryptedCommand, encryptedSymmetricKey}` pair is either public or
attacker-chosen; the sender never touches its own private key on this path.

Confidentiality against the server is real. Authenticity is nil.

Receipt does nothing to compensate: `receiveCommands`
(`SyncManager.mts:1170-1210`) decrypts and hands straight to
`receiveRemoteCommand`, which only checks `typeof remoteCommand.type ===
'string'` (`CommandManager.mts:145`) and looks up a constructor.

This is the enabling primitive for [14](14-sync-device-injection.md).

## The obvious objection: doesn't holding the keys prove the sender is a peer?

It is worth answering properly, because the objection is half right and the
answer is what the fix has to be designed against.

The barrier today is real but accidental. A device's public key never leaves a
device in the clear:

- the pairing handshake sends `responderEncryptedPublicKey`, wrapped under the
  JPAKE-derived sync key (`SyncManager.mts:783-799`);
- peer keys otherwise travel only inside encrypted vault state (`resilver`,
  `importVaultState`);
- the server never sees or stores one — `grep -rn publicKey packages/server/src`
  returns two hits, both the pass-through of that encrypted blob
  (`server.mts:147-157`).

So in the current code, _knowing device B's public key_ is close to _being, or
having been, a device in B's vault_. That is not nothing. But it is not
authentication, for four separate reasons.

**1. Nothing defends the invariant, and nothing declares it.** The value is
typed `PublicKey`, lives in the vault, and is handled everywhere as public. No
comment anywhere says it must stay confidential. One device-management UI, one
debug export, one log line, one server-side device registry, and a benign
disclosure becomes command injection against every peer of that device. A
security property that rests on an undeclared confidentiality requirement for a
value named "public key" will not survive a refactor, and nothing in the test
suite would notice it break.

**2. "Was a peer" is not "is a peer."** `removeSyncDevice`
(`SyncManager.mts:1303-1319`) splices an array. Nothing rotates — not the
removed device's keypair, not the remaining devices'. A removed device keeps
every remaining peer's public key forever, and the server authenticates nobody:
`connect` believes any `deviceId` (`server.mts:93`) and `syncCommands` rows are
accepted from any socket for any recipient (`server.mts:223`, see
[16](16-server-authentication.md)). So a revoked device can inject an
`AddSyncDevice` command carrying a fresh keypair of its own
([14](14-sync-device-injection.md)), then `startResilver`, and the remaining
devices encrypt the whole vault to it. **Revocation is unenforceable for as long
as possession of a public key is the credential** — which is the sharpest reason
this finding has to be fixed before, not after, any device-management work.

**3. It proves set membership at best, never which peer.** There is no
`fromDeviceId`, and adding one would prove nothing, since the server is the
forwarder. This costs little while every peer is equally trusted, but it is why
nothing above the sync layer can ever be per-device: no attribution for a
destructive command, no revocation list, no restricted or read-only device.

**4. It says nothing about freshness.** The AAD binds `(commandId, recipient)`,
which blocks cross-delivery but not replay to the same recipient. There _is_ a
dedup set (`CommandManager.mts:26,44-50`), but it is keyed on the
**server-supplied** `commandId`, which is never bound to the ciphertext, so the
server replays any stored blob under a fresh id — [15](15-sync-replay-protection.md).
Possession of a key, even a secret one, never answers _when_.

A signature over `(command, commandId, recipient)` answers all four: it proves
possession of a secret that is never transmitted, names the device that holds
it, and stops meaning anything the moment that key leaves the peer list. That is
the distance between "some insider, at some point" and "device X, for you, now."

## Direction (not a design)

Commands need to be signed by the sending device, and the signature needs to
cover the command, its id, and the recipient — with the sender's identity bound
to a public key the recipient has a reason to trust
([14](14-sync-device-injection.md) is about how that trust is established), and
with a way to stop trusting it that actually takes effect (point 2 above).

The keypair to sign with already exists. This is not a new-primitive problem;
it is a protocol-design problem, which is why it needs the sync review rather
than a patch.

## Resolution

Done 2026-09-17, together with [15](15-sync-replay-protection.md). A command is
now signed by the sending device, and a device only acts on one if a peer
**currently in its own device list** signed it, for this recipient, under this
command id.

The change is larger than "add a signature", because the keypair that was there
could not produce one: RSA-OAEP is an encryption primitive, and the library had
no signing path at all. Rather than bolt RSA signatures onto a hierarchy that
[10](10-rsa-layer.md) already described as incidental, the asymmetric layer was
replaced — X25519 for key agreement, Ed25519 for signatures. See
[10](10-rsa-layer.md)'s amendment, whose Decision this reverses, and
[02](02-ciphertext-authenticity.md)'s.

### What landed

- **The signed envelope.** A command travels as
  `{from, signature, payload}` **inside** the ciphertext, where `payload` is the
  exact JSON that was signed. `buildCommandSignatureMessage` in `canonical.mts`
  covers `(commandId, fromDeviceId, toDeviceId, payload)` with the same
  length-prefixed encoder the AADs use. Nothing is added to the wire envelope,
  so the server relays it untouched, **needs no change and no migration**, and
  still cannot see who is talking to whom. Its own tests pass unedited, which is
  the evidence for that claim.
- **`payload` is signed verbatim**, not re-serialised from a parsed object. A
  signature over `JSON.stringify(parsed)` holds only while two builds agree
  about key order and number formatting.
- **Verification is a refusal ladder**, in `SyncManager.verifyCommandEnvelope`:
  shape, then sender (looked up in `syncDevices`, never this device itself),
  then signature, then `command.id === commandId`. Every failure produces the
  same warning — telling a prober whether a device id is known is already
  telling them something.
- **Revocation works now.** `removeSyncDevice` used to splice an array and
  change nothing about what the removed device could do. A device that is not in
  the list has no key to verify against, so it can no longer say anything this
  device will act on. That is point 2 of the finding, closed.
- **The curve hierarchy.** `PublicKey`/`PrivateKey` are X25519, base64 of 32 raw
  bytes; `SigningPublicKey`/`SigningSecretKey` are Ed25519. Both keypairs are
  created together, sealed together under an HKDF-derived key, and derived back
  rather than stored. `platformProviders/shared/curves.mts` is `@noble/curves`
  and is shared by BOTH providers: the RSA layer was node-forge in the browser
  and OpenSSL in node, agreeing only while every padding parameter matched,
  which is how the OAEP MGF1 split got in. There are no parameters to disagree
  about now, and one implementation instead of two.
- **The at-rest self-wrap is gone.** `encryptedSymmetricKey` is sealed under a
  password-derived key, not wrapped to this device's own public key. That is the
  forgery [02](02-ciphertext-authenticity.md) had to add `envelopeMac` to catch,
  closed at its source; the MAC stays for the cleartext fields.
- **Vault transfers are signed too** — beyond this finding's letter, which is
  about commands, but the same defect on the same path: a resilver is sealed to
  a public key and its `fromDeviceId` is stamped by the server. The initial
  vault of a pairing flow deliberately is **not** signed: it arrives under the
  JPAKE-derived key, so the channel is already mutually authenticated, and it is
  where the responder learns the initiator's signing key in the first place.
- **No new version number.** Every install in the wild is on storage version 1,
  and version 2 had never shipped, so version 2 was redefined in place rather
  than superseded. `STORAGE_VERSION`, `COMMAND_VERSION` and `PAIRING_VERSION`
  keep their values; their JSDoc records the rule. `BaseCommand` also now stamps
  `COMMAND_VERSION` instead of the literal `'1.0'` it had been sending while the
  constant said `'2.0'`.
- **A visible consequence, stated rather than engineered around.** A v1 vault's
  RSA keypair cannot become a curve keypair, so the migration mints a fresh pair
  and `reportStorageUpgrade` says so: paired devices have to pair again. The
  alternative — announcing new keys over the old channel — would authenticate
  them with exactly the primitive this finding says authenticates nothing.

### Verified by mutation

| Mutation                                          | Result                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| accept any signature                              | 4 red: the forged-signature, wrong-recipient and payload-id cases, plus the resilver signature case        |
| look the sender up without matching its device id | 3 red: the not-a-peer case, the removed-peer case, and the one asserting every refusal says the same thing |
| skip the `command.id === commandId` check         | 1 red: the payload-id case — reachable only by a device already trusted, which is why it is there          |
| skip the persisted duplicate check                | 1 red: the applied-before-a-restart case                                                                   |
| skip the replay floor                             | 1 red: the below-the-floor case                                                                            |
| stop recording applied commands                   | 1 red: the record-what-was-applied case                                                                    |

Cross-provider agreement is pinned in `tests/CryptoProviders`: each provider
verifies the other's signatures, a seal opens only for the key it names, and the
wrong signer, a changed message and a malformed signature all resolve false
rather than throwing.

### Not closed by this

[14](14-sync-device-injection.md). Enrolment is no longer open to anyone holding
a public key — an `AddSyncDeviceCommand` has to be signed by a device already in
the list — but a trusted peer can still enrol whatever it likes, there is no key
pinning, and nothing surfaces a new device to the user.
[16](16-server-authentication.md) is likewise unchanged: a socket hijacker can
still suppress and observe, it just cannot inject any more.
