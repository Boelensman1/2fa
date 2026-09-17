# 16 — The sync server authenticates nothing

**Verdict:** weak — partly a deliberate design position, with one real hijack
**Status:** open
**Priority:** unranked — belongs to the sync-protocol review ([12](12-sync-findings-index.md))
**Touches:** `packages/server/src/server.mts:37-51`,
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

## Resolution

_Not started._ Still **open**, and the Direction above is unchanged.

[13](13-sync-command-authentication.md) landed 2026-09-17 and changes what a
hijacked connection is worth, without touching this finding. A socket that
claims someone else's `deviceId` still displaces the real device and still
consumes its queued commands, so **denial of service and message suppression are
untouched**. What it can no longer do is act: commands are signed, so a hijacker
cannot inject one, and a resilvered vault it sends is refused. The "much better
position from which to mount [15](15-sync-replay-protection.md)" is also gone —
replays are refused by a record that now survives a restart.

Proving possession of the device key on connect, and not evicting a proven
connection for an unproven one, is still the fix. The primitive it needs
(`CryptoLib.sign`/`verify`) now exists.
