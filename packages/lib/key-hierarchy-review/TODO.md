# Key hierarchy review — TODO

Tracking list for [the review](README.md). One line per finding; the file itself
holds the detail. Tick a box only when that file's `Status:` line and the
[README table](README.md#status) say `done` too.

## Done

- [x] **01** — argon2id raised to m = 64 MiB / t = 3 / p = 4, parameters
      recorded per vault
- [x] **02** — AES-256-GCM with AAD, plus a password-keyed `envelopeMac`
- [x] **03** — `storageVersion` is read on load and a too-new vault is refused.
      Carries an amendment on the add-device pairing payload, the third
      unversioned surface, versioned with the jpake-ts 2.0 upgrade.
- [x] **04** — `changePassword` draws a fresh salt and a fresh symmetric key,
      and emits `PasswordChanged`. The device keypairs are still not rotated, by
      design — rotating them is still a re-pair. Its extension half is **not**
      done — see below.
- [x] **05** — entries and sync devices validated at ingest on both the load
      path and the sync path; the load path **refuses** rather than drops, and
      `addSyncDevice` is the chokepoint with a 64-device cap
- [x] **06** — KDF vectors, a frozen v1 fixture vault and stored-format
      assertions
- [x] **07** — export/import-unlocked-session api on `favalib`; the extension
      no longer needs the raw master password. Its extension half is **not**
      done — see below.
- [x] **08** · **09** — reviewed, no action
- [x] **10** — reviewed, no action, then **superseded**: its Decision to keep
      the RSA layer was reversed by `13`, which replaced it with X25519 and
      Ed25519. The at-rest self-wrap and the PBES2 blob are gone with it
- [x] **13** — sync commands are signed by the sending device and refused unless
      a peer currently in the vault's device list signed them, for this
      recipient, under this command id. Took the asymmetric layer with it;
      storage version 2 was redefined rather than superseded, since nothing in
      the wild had ever written one
- [x] **14** — closed by **deciding** peer trust is flat and writing that down
      (`11`), not by gating enrolment. A quarantine was designed and rejected:
      a pending device silently stops receiving entries, so the honest case
      fails more often than the attack. Instead enrolment is legible —
      provenance, a key fingerprint, a `SyncDeviceAdded` event, an
      acknowledgement that gates nothing — and three things that contradicted
      even a flat model are fixed: removal converges via tombstones, keys are
      pinned on first receipt with a loud conflict, and a peer may rename only
      itself. Library only; the browser extension is the intended consumer of
      the event and is not in this tree
- [x] **15** — the command id is bound into the signed payload, the
      processed-command record is persisted and bounded (30 days / 1000, with a
      per-peer floor so pruning cannot weaken it), the dead nonces are deleted
      and the resilver replay alarm is no longer swallowed. Half the finding had
      already lapsed when it was fixed — the correction is in the file

## Open — key hierarchy

- [ ] **04 · 07 (extension half)** — one commit on the `app-extension` branch:
      store the exported session blob instead of `vaultPassword`, and clear it
      on `lock()` and on `FavaLibEvent.PasswordChanged`. There is no such code
      in this tree.

## Closed — won't fix

- [x] **18** — anti-rollback. Half done and half declined. The v1 read path is
      deleted, so the downgrade-then-migrate window is closed. The remaining
      half — a monotonic counter outside the blob, against a same-version
      snapshot replayed over a current vault — is **won't fix**, risk accepted
      2026-09-17: rolling a vault back needs write access to its storage, and an
      attacker with that already has the blob and, on the CLI, the `keytar`
      password beside it. A counter in two media would give every honest user a
      new way to be locked out of a vault that is still intact. Revisit only if
      the vault gains a medium that is already monotonic and already
      load-bearing — see [16](16-server-authentication.md).

## Open — sync layer

Only `16` is left. It belongs to a sync-protocol review that has not been scoped
([12](12-sync-findings-index.md)); `13`, `14`, `15` and `17` were each worked
through on their own terms, which is not that review. Read `14` first anyway —
it is where the peer-trust model is argued.

- [ ] **16** — narrowed 2026-09-17, still open. The sync server now refuses any
      socket that cannot prove a static shared secret (HMAC over a server nonce,
      so the secret never travels), the secret lives per vault beside
      `serverUrl` and is left out of peer-bound vault state, and `server.mts`
      was split so the handler is importable and actually tested. **Not a fix**:
      one secret held by every device gates the socket, not the `deviceId`, so a
      hijacker who holds it can still suppress and observe. Both halves of the
      original Direction were **declined**, with reasons in the file — proving
      the DEVICE key needs a server-side key registry, which is the property
      `13` was careful to avoid, and its premise (a public key "the server
      already relays") was simply wrong; refusing eviction defends a live
      connection, and the victim here is almost always offline.
- [x] **17** — done 2026-09-17. Kept the device id: the JPAKE input is ephemeral
      and 256-bit, so a salt would add neither entropy nor uniqueness, only a
      field the sync server could tamper with. The parameter is now typed
      `DeviceId`, the `as string as Salt` cast is gone, and the reasoning lives
      on `createSyncKey`. P3.
