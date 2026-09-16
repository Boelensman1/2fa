# 12 — Out-of-scope sync findings

**Status:** open — needs its own review
**Priority:** two of these are individually more severe than anything in the
key-hierarchy review

These were hit while verifying the key hierarchy and are recorded so they are
not lost. They are **sync-layer**, not key-hierarchy, and this review did not
work them through properly. Do not treat the notes below as a finished analysis.

## 1. Sync commands have no sender authentication

`SyncCommandFromServer` (`src/interfaces/protocol/ServerMessage.mts:30-34`)
carries no sender identity, and the payload is RSA-OAEP + AES-CBC with no
signature. RSA-OAEP is a **public** operation, so anyone holding a device's
public key can mint a well-formed `{encryptedCommand, encryptedSymmetricKey}`
pair for it. Confidentiality against the server is real; authenticity is nil.

## 2. Unvalidated sync-device injection

`SyncManager.importVaultState:824-826` loops `vaultState.sync.devices` straight
into `addSyncDevice` with no validation, and `AddSyncDeviceCommand.validate()`
is a hardcoded `return true`
(`src/Command/commands/AddSyncDeviceCommand.mts:56-59`, with a `// TODO:
actually validate`).

Combined with (1): an attacker-controlled public key can be added as a sync
peer, after which **every future `AddEntry` — every new TOTP secret — is
encrypted to the attacker**. This is probably the most severe finding surfaced
anywhere in this review.

## 3. Replay protection is bypassable by construction

`CommandManager.processedCommandIds` is in-memory only (reset on every restart)
and keyed on `command.id` — which is **supplied by the server**
(`SyncManager.mts:965`), while the ciphertext deliberately drops its own id
(`SyncManager.mts:882`). The server durably stores every
`{encryptedCommand, encryptedSymmetricKey}` blob and re-sends on reconnect, so
it can replay any command under a fresh `commandId` and the dedup is bypassed.

The `nonce` generated on eight message types is **read by nobody** — `grep -n
nonce packages/server/src` returns no hits, and no client checks one.

The one explicit replay check (`SyncManager.mts:383-388`, for resilver vault
data) has its `throw` swallowed by the caller's try/catch and logged as
"Failed to parse message".

## Also worth noting

- **The server authenticates nothing.** `server.mts:37-51` accepts any
  client-supplied `deviceId` with no proof, and `ConnectedDevicesManager` evicts
  the legitimate holder — so an attacker can hijack a device's queued commands.
- `createSyncKey`'s argon2 salt is the responder's `deviceId`
  (`SyncManager.mts:666,698`) — public, low-entropy, server-visible and reused
  across every pairing with that device. Immaterial to strength here (the input
  is a 256-bit ECC shared secret) but it is not a salt in any meaningful sense.

## Resolution

_Not started. Needs a dedicated sync-protocol review._
