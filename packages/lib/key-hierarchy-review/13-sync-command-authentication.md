# 13 — Sync commands have no sender authentication

**Verdict:** broken
**Status:** open
**Priority:** unranked — belongs to the sync-protocol review ([12](12-sync-findings-index.md))
**Touches:** `src/interfaces/protocol/ServerMessage.mts:30-34`,
`src/subclasses/SyncManager.mts:862-901`, `:948-985`

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
key (`SyncManager.mts:874-877`). RSA-OAEP is a **public** operation and there is
no signature anywhere in the repo — so anyone holding a device's public key can
mint a well-formed `{encryptedCommand, encryptedSymmetricKey}` pair for it.

Confidentiality against the server is real. Authenticity is nil.

Receipt does nothing to compensate: `receiveCommands`
(`SyncManager.mts:948-985`) decrypts and hands straight to
`receiveRemoteCommand`, which only checks `typeof remoteCommand.type ===
'string'` and looks up a constructor.

This is the enabling primitive for [14](14-sync-device-injection.md).

## Direction (not a design)

Commands need to be signed by the sending device, and the signature needs to
cover the command, its id, and the recipient — with the sender's identity bound
to a public key the recipient has a reason to trust
([14](14-sync-device-injection.md) is about how that trust is established).

The keypair to sign with already exists. This is not a new-primitive problem;
it is a protocol-design problem, which is why it needs the sync review rather
than a patch.

## Resolution

_Not started._
