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

_Not started._
