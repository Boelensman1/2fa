# 15 — Replay protection is bypassable by construction

**Verdict:** broken — and partly overtaken before it was fixed; see Resolution
**Status:** done
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

Done 2026-09-17, alongside [13](13-sync-command-authentication.md).

### First, a correction: half of the finding above had already lapsed

**"A malicious server replays any stored blob under a fresh `commandId`" was no
longer true when this was fixed**, and had not been since storage version 2
landed. `buildCommandAad(commandId, deviceId)` binds the id into the AES-GCM
tag on both sides (`SyncManager.mts:1032` and `:1190`), so a blob re-announced
under a different id fails to decrypt. The finding was written against the v1
CBC wire and the line references in it are from that era.

What genuinely remained was smaller and less dramatic, and is what this
resolution closes:

1. the same id arriving twice was caught only by an **in-memory** set, which a
   restart emptied — and the server redelivers everything it has not been told
   was executed, on every reconnect;
2. the nonces were decorative;
3. the one real replay alarm was swallowed.

Recording this rather than quietly fixing the smaller thing, because a reader
comparing the finding to the code would otherwise conclude the fix had missed
the point.

### What landed

- **The processed-command record is persisted.** `VaultSyncState` gains
  `processedCommands: {commands, floors}`, beside the `commandSendQueue` that
  was already stored there. Only remote commands are recorded, and only after
  they actually executed, so anything dropped for another reason stays
  redeliverable.
- **The command id is inside the signed payload.** `sendCommand` used to strip
  it (`id: undefined`) and the receiver took it from the server's envelope. Now
  it travels inside, is covered by the signature, and must match the envelope —
  so the dedup key is no longer something the server chooses.
- **The record is bounded, and pruning cannot weaken it.** Entries older than 30
  days go, and so does anything past 1000, oldest first; pruning an entry raises
  its sender's floor to that entry's timestamp, and a command at or below a
  sender's floor is refused. Forgetting an id therefore never makes it
  acceptable again. The floor is per peer and rises only from that peer's own
  traffic, so a device that has been offline for months still has its queued
  commands applied — its floor never moved.
- **A save is forced when the record grows**, even when no command changed an
  entry: the record of what has been applied is itself the thing that has to
  survive a restart.
- **The nonces are deleted.** Eight client messages carried one, the client
  generated it, `grep -rn nonce packages/server/src` returned nothing, and no
  client verified one either. A field that looks like a security control and is
  read by nobody is worse than no field, and freshness is the signature's job
  now.
- **The alarm is no longer swallowed.** A `SyncError` out of
  `handleServerMessage` is logged as itself at a new `error` severity, instead
  of being flattened into `Failed to parse message` by the socket's catch. So
  "got vault data while no resilver was requested, probably replay attack!"
  reaches the user rather than looking like a truncated frame. The CLI treats
  `error` like `warning` (it surfaces it); the PWA logs it to `console.error`.
- **Malformed records are refused at load, not reset.** Absent means "nothing
  applied yet", which is right for every vault written before the field existed.
  Present but the wrong shape throws: silently starting replay protection over
  is the one repair whose cost is invisible, because the vault works perfectly
  afterwards and simply accepts commands it has already applied.

### Verified by mutation

Listed in [13](13-sync-command-authentication.md)'s table, since the two
changes landed together: disabling the persisted duplicate check, the floor, or
the recording each reddens exactly one test.

### Batch delivery and acknowledgment follow-up

Incoming batches are serialized, and each command is authenticated immediately
before execution against the current peer list. Enrollment and revocation from
earlier commands therefore apply to later commands in the same batch. A peer's
signing key is checked again after asynchronous verification.

Applied commands retain their origins until the whole batch is recorded; there
is no capped pending-origin map that can forget commands before they execute.
Pruning happens after the batch, so equal timestamps cannot prematurely raise
a floor past unprocessed commands. A failed replay-state save is retried before
acknowledgment, including when the next delivery contains only duplicates.

Authenticated duplicates are acknowledged without re-execution or a warning.
Authenticated commands at or below their peer's floor are also acknowledged,
with a warning: the client has permanently refused them, so the server should
delete them. Authentication failures and unsuccessful new commands remain
unacknowledged. These behaviors are covered by
`tests/subclasses/sync-command-delivery.test.mts`, including batches exceeding
1000 commands, restarts, overlapping deliveries, and failed saves.

### Not closed by this

Ordering. Commands are still applied in sender-timestamp order
(`CommandQueue`), and a hostile peer can pick its own timestamps. That is a
peer-trust question, not a freshness one, and it belongs with
[14](14-sync-device-injection.md).

**Amended 2026-09-17:** [14](14-sync-device-injection.md) closed, and this
closed with it — as a decision rather than a fix. Peer trust is flat: a peer
holds every decrypted seed in the vault already, so a peer choosing the
timestamps its own commands are ordered by is a peer acting inside its trust,
and is recorded as undefended in [11](11-threat-model.md) rather than tracked as
open. Nothing about ordering changed in the code.
