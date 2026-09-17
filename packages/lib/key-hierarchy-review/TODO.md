# Key hierarchy review — TODO

Tracking list for [the review](README.md). One line per finding; the file itself
holds the detail. Tick a box only when that file's `Status:` line and the
[README table](README.md#status) say `done` too.

## Done

- [x] **01** — argon2id raised to m = 64 MiB / t = 3 / p = 4, parameters
      recorded per vault (`95075ca`)
- [x] **02** — AES-256-GCM with AAD, plus a password-keyed `envelopeMac`
      (`95075ca`)
- [x] **03** — `storageVersion` is read on load and a too-new vault is refused
      (`62aaf6b`)
- [x] **06** — KDF vectors, a frozen v1 fixture vault and stored-format
      assertions (`733208a`)
- [x] **08** · **09** · **10** — reviewed, no action. `10` carries an amendment
      on the at-rest RSA self-wrap.

## Open — key hierarchy

- [ ] **04** — rotate the salt and the symmetric key in `changePassword`; clear
      the extension's session password. P1, ~20 lines.
- [ ] **05** — run `validateEntryFatal` (drop-and-log) on the load path and in
      `importVaultState`; validate and cap `sync.devices`. P1, ~15 lines.
- [ ] **07** — export/import-unlocked-session API on `favalib` so the extension
      stops storing the raw master password. P2, new public API.
- [ ] **18** — anti-rollback. Two parts: delete the v1 read path once installs
      have upgraded (calendar call), then a monotonic counter outside the blob.
      P1.

## Open — sync layer

Unranked on purpose; they belong to a sync-protocol review that has not been
scoped ([12](12-sync-findings-index.md)). Read `14` first.

- [ ] **13** — sign sync commands; bind sender, command id and recipient.
      Prerequisite for the two below.
- [ ] **14** — keep device enrolment on the authenticated path;
      `AddSyncDeviceCommand.validate()` must actually validate. Most severe
      finding in the review.
- [ ] **15** — bind the command id into the authenticated payload; persist the
      processed-id set; use the nonces or delete them.
- [ ] **16** — prove possession of the device private key on connect, and do not
      evict a proven connection for an unproven one.
- [ ] **17** — a real per-pairing salt for `createSyncKey`, or a comment saying
      the device id is deliberate. Drop the `as string as Salt` cast. P3.
