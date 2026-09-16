# 15 — Replay protection is bypassable by construction

**Verdict:** broken
**Status:** open
**Priority:** unranked — belongs to the sync-protocol review ([12](12-sync-findings-index.md))
**Touches:** `src/subclasses/CommandManager.mts:20,44-50`,
`src/subclasses/SyncManager.mts:882`, `:965`, `:383-388`

## Finding

**The dedup key is chosen by the server.** Verified on both sides:

- On send, the command deliberately drops its own id before encryption
  (`SyncManager.mts:882`): `id: undefined` inside the `JSON.stringify` that
  becomes `encryptedCommand`.
- On receive, the id is taken from the **server-supplied** envelope
  (`SyncManager.mts:965`): `id: data.commandId`.

So the id is never bound to the ciphertext. The dedup set itself
(`CommandManager.mts:20,44-50`) is a plain in-memory `Set<string>`:

```ts
  private processedCommandIds = new Set<string>()
```

Two consequences:

1. **A malicious server replays any stored blob under a fresh `commandId`** and
   the dedup is bypassed entirely. The server already persists every
   `{encryptedCommand, encryptedSymmetricKey}` durably
   (`server.mts:174-180`) and re-sends the queue on every reconnect
   (`server.mts:43-49`).
2. **The set is in-memory only** and resets on every restart, so even
   well-behaved duplicates survive a process restart.

**The nonces are decorative.** Verified: clients generate one on eight message
types (`SyncManager.mts:525, 628, 657, 717, 767, 927, 1009, 1067` via
`getNonce()`), `grep -rn nonce packages/server/src` returns **no hits at all**,
and no client verifies one either.

**The one real replay check is swallowed.** `SyncManager.mts:383-388` throws
`'Got vault data while no resilver was requested, probably replay attack!'` —
but `handleServerMessage` is wrapped in a try/catch that logs it as
`Failed to parse message`, so the alarm never reaches anyone.

## Direction (not a design)

Bind the command id into the authenticated payload rather than taking it from
the envelope — which falls out naturally once commands are signed
([13](13-sync-command-authentication.md)). Persist the processed-id set, or
replace it with a monotonic per-peer counter. Either use the nonces or delete
them; a field that looks like a security control and is read by nobody is worse
than no field. And stop swallowing the resilver replay error.

## Resolution

_Not started._
