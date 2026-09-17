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
- [ ] **18** — anti-rollback. Two parts: delete the v1 read path once installs
      have upgraded (calendar call), then a monotonic counter outside the blob.
      P1.

## Open — sync layer

Unranked on purpose; they belong to a sync-protocol review that has not been
scoped ([12](12-sync-findings-index.md)). `13` and `15` were fixed on their own
terms, which is not that review. Read `14` first.

- [ ] **14** — keep device enrolment on the authenticated path. Narrowed twice
      and still open: `05` took the shape half, `13` took the "anyone holding a
      public key" half, and what is left is enrolment by a peer that is trusted
      but hostile, key pinning on first receipt, and a confirmation the user can
      see. Most severe finding in the review.
- [ ] **16** — prove possession of the device secret key on connect, and do not
      evict a proven connection for an unproven one. The primitive it needs
      (`CryptoLib.sign`/`verify`) now exists; a hijacker can already only
      suppress and observe, never inject.
- [ ] **17** — a real per-pairing salt for `createSyncKey`, or a comment saying
      the device id is deliberate. Drop the `as string as Salt` cast. P3.
