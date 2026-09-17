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
      and emits `PasswordChanged`. The RSA keypair is still not rotated, by
      design. Its extension half is **not** done — see below.
- [x] **05** — entries and sync devices validated at ingest on both the load
      path and the sync path; the load path **refuses** rather than drops, and
      `addSyncDevice` is the chokepoint with a 64-device cap
- [x] **06** — KDF vectors, a frozen v1 fixture vault and stored-format
      assertions
- [x] **07** — export/import-unlocked-session api on `favalib`; the extension
      no longer needs the raw master password. Its extension half is **not**
      done — see below.
- [x] **08** · **09** · **10** — reviewed, no action. `10` carries an amendment
      on the at-rest RSA self-wrap.

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
scoped ([12](12-sync-findings-index.md)). Read `14` first.

- [ ] **13** — sign sync commands; bind sender, command id and recipient.
      Prerequisite for the two below.
- [ ] **14** — keep device enrolment on the authenticated path. The shape half
      landed with `05` (`validate()` is no longer `return true`, and there is a
      cap), but every attack in the finding uses a _well formed_ record, so the
      finding stands. Most severe finding in the review.
- [ ] **15** — bind the command id into the authenticated payload; persist the
      processed-id set; use the nonces or delete them.
- [ ] **16** — prove possession of the device private key on connect, and do not
      evict a proven connection for an unproven one.
- [ ] **17** — a real per-pairing salt for `createSyncKey`, or a comment saying
      the device id is deliberate. Drop the `as string as Salt` cast. P3.
