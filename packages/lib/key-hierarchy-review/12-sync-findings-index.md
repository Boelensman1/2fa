# 12 — Out-of-scope sync findings (group index)

**Status:** open — needs a dedicated sync-protocol review
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

| #                                       | Finding                                         | Verdict                             |
| --------------------------------------- | ----------------------------------------------- | ----------------------------------- |
| [13](13-sync-command-authentication.md) | Sync commands have no sender authentication     | broken                              |
| [14](14-sync-device-injection.md)       | Unvalidated sync-device injection               | broken — most severe found anywhere |
| [15](15-sync-replay-protection.md)      | Replay protection is bypassable by construction | broken                              |
| [16](16-server-authentication.md)       | The sync server authenticates nothing           | weak by design, with a real hijack  |
| [17](17-synckey-salt.md)                | `createSyncKey`'s salt is a public device id    | untidy                              |

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

_Not started._
