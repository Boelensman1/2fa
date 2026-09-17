# 16 — The sync server authenticates nothing

**Verdict:** weak — partly a deliberate design position, with one real hijack
**Status:** open — narrowed 2026-09-17 by a connection gate, see Resolution
**Priority:** unranked — belongs to the sync-protocol review ([12](12-sync-findings-index.md))
**Touches:** `packages/server/src/createSyncServer.mts`,
`packages/server/src/ConnectionAuthManager.mts`,
`packages/server/src/ConnectedDevicesManager.mts:24-30`

## Finding

There is no user or account concept, no credential, and no proof of device
identity. A socket claims a `deviceId` and is believed — verified:

```ts
    case 'connect': {
      const { deviceId } = message.data
      connectedDevices.addDevice(deviceId, ws)
```

...and the queued commands for that device are then sent to it immediately
(`server.mts:43-49`).

`addDevice` **evicts the legitimate holder** first — verified
(`ConnectedDevicesManager.mts:24-30`):

```ts
  public addDevice(deviceId: DeviceId, ws: WebSocket) {
    // Remove existing connection if any
    this.removeDevice(deviceId)
```

So an attacker who learns a `deviceId` can connect, displace the real device,
and receive its pending encrypted commands.

## How bad this actually is

Less bad than it first looks, and it should not be overstated:

- The hijacker gets **ciphertexts**, not plaintext. Commands are encrypted to
  the real device's RSA public key, which the hijacker does not hold.
- The server being untrusted is an explicit design choice, and the rest of the
  design mostly honours it — the server stores no key material and no vault
  blob.

What it does buy an attacker is **denial of service and message suppression**
(the real device is disconnected; its commands are consumed and then deleted
from the queue on `syncCommandsExecuted`), plus a much better position from
which to mount [15](15-sync-replay-protection.md).

A `deviceId` is a UUIDv4, so guessing one is not the threat — leaking one is.
It travels inside vault state and command payloads.

## Direction (not a design)

At minimum, prove possession of the device's private key on connect
(challenge–response against the public key the server already relays), and do
not evict an existing connection in favour of an unproven one. Anything more —
accounts, rate limiting — is a product decision, not a security prerequisite.

## Correction to the Direction

The Direction above says "challenge–response against the public key the server
already relays". **The server relays no such thing.** A device's public keys
cross it exactly once, in `publicKeyAndDeviceInfo`, and they are sealed under
the JPAKE-derived pairing key — `EncryptedPublicKeys`, opaque to the server,
which is the property [13](13-sync-command-authentication.md) went to some
trouble to keep. The server has never held a device public key in the clear and
holds none now.

So the Direction was not a small step from where the code stood. Proving
possession of a device key on connect needs the server to have a key to check
against, which means giving it a device registry: a table, a trust-on-first-use
rule for a device it has not seen, and a race over who claims an unseen
`deviceId` first. That is a real design with real costs, and it trades away the
one thing this server is good at — knowing nothing.

**Declined, 2026-09-17.** Keeping the server ignorant of device keys was judged
worth more than the difference between "a leaked `deviceId`" and "a leaked
`deviceId` plus a deployment secret". What landed instead is below.

## Resolution

**Still open, and narrower.** A connection gate landed 2026-09-17: the server
refuses any socket that cannot prove a static secret shared by every device of a
deployment.

### What landed

- **The secret is proved, not sent.** The server speaks first, with a nonce; the
  client answers with `HMAC-SHA256(secret, buildConnectAuthMessage(nonce))`. The
  secret itself never crosses the wire, so a plain `ws://` link in development
  does not leak it and a captured frame does not replay. The nonce is drawn per
  socket and consumed by the first proof against it, so one connection buys one
  guess.
- **One implementation, two packages.** `utils/connectAuth.mts` is a pure leaf in
  `favalib`, exported as `favalib/protocol/connectAuth` and imported by the
  server — the first runtime import of `favalib` by `favaserver`, which until now
  took only types. A server with its own copy of the arithmetic is the hazard
  `platformProviders/shared/curves.mts` describes, one repository boundary
  further out, and it would surface as "everyone is suddenly unauthorized" rather
  than as a test.
- **The gate is ahead of the switch, not inside it.** A socket may send exactly
  one thing before it is authenticated. Everything else — `connect` included —
  closes it. That is what stops the hijack in this file's Finding from being
  reachable by anyone who merely knows a `deviceId`.
- **One refusal for all of it.** A wrong proof, a message sent too early and a
  proof that never arrived all close with 4401 and the same reason. A server that
  tells them apart is answering questions for whoever is probing it. The client
  treats 4401 as terminal and stops reconnecting, because a wrong secret does not
  fix itself and a five-second retry loop would bury the one message that says so.
- **The secret is per vault and never leaves it.** It sits beside `serverUrl` in
  `VaultSyncState`, so it is encrypted at rest with everything else.
  `PersistentStorageManager` leaves it out of the peer-bound form of that struct,
  so it appears in no message on this wire, sealed or otherwise — `serverUrl`
  crosses (and is ignored on arrival, which is what makes finding
  [12](12-sync-findings-index.md)'s "`serverUrl` cannot be redirected" true); the
  secret does not cross at all.
- **A vault is created with sync off.** `createNewFavaLibVault` lost its
  `serverUrl` parameter: url and secret are one setting, supplied together
  through `setSyncServerUrl`, so "has a server url, cannot authenticate to it"
  has nowhere to come from. In the PWA the user types both into a form, which is
  the only way a public bundle can hold a secret it does not publish.
- **The server refuses to start without one.** `sync.sharedSecret` is required in
  the config schema, and `knexfile.ts` reads that config at module load, so a
  deployment that forgets it gets no server, no migrations and no test run. A
  gate that silently does nothing when unconfigured is worse than no gate,
  because it is indistinguishable from a working one.
- **The server was restructured to be testable.** `server.mts` opened a listener
  at module scope, so `test/server.test.mts` tested a hand-written copy of
  `handleMessage` that had already drifted from it. The handler moved to
  `createSyncServer.mts`; the copy is gone and the tests drive the real thing.
- **Eviction was left alone.** The Direction's second half — do not evict an
  existing connection for an unproven one — was considered and dropped. The
  victim of this attack is almost always offline, so there is no live connection
  to defend, and refusing eviction would have cost a ping/pong heartbeat and a
  way for a device with a half-dead socket to lock itself out.

### Why this does not close the finding

**Every device of a deployment holds the same secret.** It says who may open a
socket and nothing at all about who is on the other end of one, so a `deviceId`
is still a claim and still believed. What changed is the price:

|                        | before                    | after                                                        |
| ---------------------- | ------------------------- | ------------------------------------------------------------ |
| to hijack a `deviceId` | learn a leaked `deviceId` | learn a leaked `deviceId` **and** hold the deployment secret |

Two things make that narrowing real rather than cosmetic. A `deviceId` travels
only inside encrypted vault state and encrypted command payloads, so learning one
already implies a compromised peer. And the secret is user-supplied — it is not
compiled into the PWA bundle — so "can load the app" does not mean "holds the
secret".

What an attacker with both still gets is what this file said they got, minus
nothing: they evict the real device and drain its queue, and
`syncCommandsExecuted` deletes those rows. The sender dropped them from its send
queue on ack, so **nothing re-sends them** — the victim silently and permanently
misses commands and the vaults diverge until someone resilvers. Read as risk
rather than as a table: for a self-hosted server shared by a handful of trusted
devices, the remaining attacker is a peer that is already in the vault's device
list and can do worse things more easily. That is the judgement this was accepted
under; it is not a general claim.

### Verified by mutation

| Mutation                                  | Result                                                             |
| ----------------------------------------- | ------------------------------------------------------------------ |
| accept any proof                          | 13 red across the gate and the handler's own tests                 |
| skip the unauthenticated-message gate     | 6 red, including the `connect` hijack and the uniform-refusal case |
| do not consume the nonce after an attempt | 2 red: the one-guess-per-connection cases                          |
| drop the auth timeout                     | 1 red: the socket that connects and says nothing                   |
