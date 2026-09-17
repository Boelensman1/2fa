# 12 — Out-of-scope sync findings (group index)

**Status:** open — four of five closed; `16` still needs a dedicated
sync-protocol review
**Priority:** unranked here on purpose — see below

These were hit while verifying the key hierarchy. They are **sync-layer**, not
key-hierarchy, so they sit outside the four threads this review was asked to
judge. Two of them are individually more severe than anything in
[the main table](README.md).

Each claim below was **verified first-hand against the source** — the file and
line references were read, not inferred. What this review did _not_ do is work
the sync protocol through as a whole: there is no threat model for it here, no
assessment of how the findings compose beyond the one noted in
[14](14-sync-device-injection.md), and no remediation design. Treat these files
as verified observations with a suggested direction, not as a finished analysis.

**They are deliberately left unranked against the key-hierarchy items.** Ranking
them would imply a plan that has not been made. Rank them as part of the sync
review.

| #                                       | Finding                                         | Verdict                                       |
| --------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| [13](13-sync-command-authentication.md) | Sync commands have no sender authentication     | broken — **done**                             |
| [14](14-sync-device-injection.md)       | Unvalidated sync-device injection               | broken — most severe found anywhere; **done** |
| [15](15-sync-replay-protection.md)      | Replay protection is bypassable by construction | broken — **done**                             |
| [16](16-server-authentication.md)       | The sync server authenticates nothing           | weak by design, with a real hijack            |
| [17](17-synckey-salt.md)                | `createSyncKey`'s salt is a public device id    | untidy — **done**                             |

## What holds

Worth stating, because the sync design is not uniformly bad and the good parts
should survive any fix:

- **The server cannot read vault contents.** Everything relayed is encrypted to
  keys it never sees, and it persists only a command queue.
- **JPAKE pairing is sound.** The out-of-band secret is 60 CSPRNG bytes
  (`SyncManager.mts:489-491`), so the pairing channel is not offline-attackable
  even though the server sits in the middle of the exchange.
- **`serverUrl` cannot be redirected** by a forged vault state.

The failures are all in _authenticity_, not confidentiality — which is the same
shape as [02](02-ciphertext-authenticity.md) in the main review.

## Resolution

Partly done, 2026-09-17. `13` and `15` landed together: sync commands are signed
by the sending device and verified against the peer list, and the record of what
has been applied now survives a restart. The asymmetric layer was replaced with
X25519/Ed25519 to get there — see [13](13-sync-command-authentication.md) and
[10](10-rsa-layer.md)'s amendment.

**This still is not the sync-protocol review this file asks for.** Two findings
were fixed on their own terms; nobody has worked the protocol through as a
whole. What changed for the rest:

- **`14`** — narrowed, not closed. Enrolment is no longer open to anyone holding
  a public key, but a trusted peer can still enrol anything, and there is still
  no key pinning and no user-visible confirmation.
- **`16`** — narrowed 2026-09-17, still open. A connection gate landed: the
  server refuses any socket that cannot prove a static secret shared by every
  device of a deployment, proved as an HMAC over a server nonce rather than
  sent. That raises the hijack from "learn a leaked `deviceId`" to "learn a
  leaked `deviceId` and hold the deployment secret", and it is not a fix,
  because one secret held by every device says nothing about which device is on
  a socket. The half of the Direction asking for proof of the DEVICE key was
  **declined**, with the reasoning in the file: its premise was wrong — the
  server relays public keys sealed, never in the clear — and doing it would have
  meant giving the server a device-key registry.
- **`17`** — untouched.

**`17` closed 2026-09-17**, after the above was written: the device id stays —
the JPAKE secret it derives from is ephemeral, so a random salt would have added
neither entropy nor uniqueness, only a tamperable field crossing this very
server — and the `as string as Salt` cast is gone, with the reasoning moved into
`createSyncKey`'s doc comment. No wire change, so nothing here moves with it.

The "what holds" list below is still accurate, with one change and one addition.

**The server has been changed**, by `16`'s connection gate. That was a design
goal of `13`'s fix — the signature travels inside the ciphertext, so the server
needed no change and no migration — and it held until a finding about the server
itself had to be answered. What `13` earned is still intact and was the reason
`16` was answered the way it was: the server still cannot read a command, still
cannot see who is talking to whom, and still holds no key material. The gate
needed no migration either; the only new state is per socket and in memory.

The addition: **the shared secret is stored and never sent.** It lives beside
`serverUrl` in the vault, and is left out of the peer-bound vault state, so it
appears in no message on this wire at all.

**`14` closed 2026-09-17**, and it is the one worth knowing about here because
it settles a question this index left open.

Peer trust is **flat, by decision**: a peer holds every decrypted seed in the
vault already, so the data commands are not an escalation, and a peer enrolling
a device is in-model rather than a hole. A quarantine was designed and rejected —
a pending device silently stops receiving entries, so the honest case fails more
often and less visibly than the attack. What the library does instead is make
enrolment legible: who introduced a device, a key fingerprint the introducing
peer did not choose, and an event. Acknowledgement gates nothing.

Three things that contradicted even that flat model were fixed: removal now
converges and cannot be undone by a peer, keys are pinned on first receipt and a
conflict refuses loudly, and a peer may rename only itself. `15`'s leftover
ordering item closes under the same decision, and the assumption is recorded in
[11](11-threat-model.md) rather than left undeclared. `14` itself needed no
server change — everything it stores is local opinion about a peer — but the
streak that claim used to be part of ended with `16`, above.

**`16` is now the only open sync finding**, and the sync-protocol review this
file asks for still has not happened. Nothing in `14`'s fix is that review
either — it worked one finding through on its own terms, like `13`, `15` and
`17` before it.
