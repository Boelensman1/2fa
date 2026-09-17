# 18 — Rollback to an earlier vault is still undetectable

**Verdict:** weak — the part of [02](02-ciphertext-authenticity.md) that the
AEAD could not close
**Status:** closed — **won't fix**; risk accepted 2026-09-17. The downgrade half
was fixed; the rollback half is accepted, see [Resolution](#resolution)
**Priority:** — (was P1)
**Touches:** `app-cli/src/utils/loadVault.mts:22-47`, `src/version.mts`
(`LEGACY_STORAGE_VERSION`), `src/utils/creationUtils.mts`

## Finding

[02](02-ciphertext-authenticity.md) said the AAD binding was "what actually
stops the `vault.json.backup` swap". **It is not, and neither is the envelope
MAC that shipped with it.** Both are functions of the stored envelope, and a
backup is a previously valid envelope: same `salt`, same `storageVersion`, same
`kdf`, same MAC key. Everything verifies, because everything did verify when
that file was written.

No authenticator over a single file can detect this. Distinguishing "the current
vault" from "a vault this device wrote last Tuesday" needs state the attacker
cannot also roll back — a monotonic counter somewhere other than the file.

Two variants, and the second is the wider one:

### Same-version rollback

Copy `vault.json.backup` over `vault.json` and the vault silently reverts:
deleted TOTP seeds come back, newly added ones vanish. The CLI writes a backup
on **every** save, to one fixed path that each save overwrites — so there is
exactly one backup at a time, the state immediately before the last save, not an
accumulating set. It is never removed while the vault lives; as of `02` it is
deleted on `favacli vault delete`, so an explicitly deleted vault no longer
leaves a readable copy behind. That reduces the exposure. It does not close it —
the backup exists for the entire life of the vault, which is the point of it.

The PWA keeps no backup (`app-browser`'s `localStorage` key
`lockedRepresentation` is overwritten in place), so this is a CLI-shaped problem
today. It is not a CLI-only problem: any storage the user can snapshot — a
filesystem snapshot, a synced folder, a backup tool — is the same primitive.

### Downgrade-then-migrate, while the v1 read path existed — **closed**

**It was wider than plain rollback, and needed no matching salt or `kdf` block
at all.** A v1 blob dropped over a v2 vault opened:
`loadFavaLibFromLockedRepesentation` read it through
`decryptKeysV1`/`decryptSymmetricV1` and then — by design — re-wrapped it to v2
and saved. The envelope MAC did not help, because a v1 blob carries none and was
not expected to.

That was the migration path working exactly as intended, and a downgrade window
that stayed open as long as the v1 reader did.

The v1 read path is gone. Not migrated on a schedule — deleted, as a clean
break: a vault below `STORAGE_VERSION` now raises
`UnsupportedStorageVersionError` at the version gate, before anything is derived
or decrypted, and nothing is written. Users cross the break by exporting their
entries under the older build and importing them under this one; the export is a
list of `otpauth://` URIs and carries no storage version, so it crosses
unchanged.

The break costs nothing that the migration did not already cost. A v1 vault's
RSA keypair cannot become a curve one, so the migration minted a fresh keypair
and every peer had to pair again regardless — and the queued commands were
dropped either way, being v1-CBC payloads no upgraded peer would accept.

## What to do

Two separate things. The first was done; the second is **not being done** — see
[Resolution](#resolution).

1. ~~**Close the downgrade window by deleting the v1 read path.**~~ **Done.**
   `decryptKeysV1`, `decryptSymmetricV1`, `LEGACY_STORAGE_VERSION`, the
   `isLegacy` branch and node-forge are all gone, and with them the last
   RSA-shaped code in the library. `tests/fixtures/vault-v1.json` stayed checked
   in and is now the fixture that proves the refusal is clean — a version error
   naming the export path, not a decryption failure, and no write attempted.
   The v1 argon2 anchor in `kdf-vectors.test.ts` stayed too: the cheap
   parameters outlived the format, since `createSyncKey` still derives with
   them.
2. ~~**Anti-rollback proper: a monotonic counter outside the blob.**~~ **Won't
   fix.** The design, for whoever revisits it: a `saveCounter` inside the
   encrypted vault state and covered by the envelope MAC, plus a copy in storage
   the attacker would have to roll back separately. The CLI already has a
   different medium available — the OS keychain, where the password lives
   (`keytar`, service `favacli`). The PWA has no equivalent that is not equally
   copyable, so for the PWA this would have to be the sync server, which brings
   in [16](16-server-authentication.md).

Do **not** describe 1 as an anti-rollback measure. It closed one window and
left the other open, deliberately.

## How to verify

- With the CLI, `cp vault.json.backup vault.json`: the vault opens. That is the
  accepted behaviour, and there is no assertion to add for it — pinning it would
  be asserting a defect, and leaving it unpinned keeps the door open for the
  counter if [16](16-server-authentication.md) ever makes it cheap.
- Drop a v1 blob over a v2 vault: it is refused, and the stored blob is
  unchanged afterwards. `tests/fixtures.test.mts` asserts both halves, per
  provider and on both load paths, and
  `app-browser/e2e/vault-v1-refused.spec.ts` asserts the same through the UI.
- `favacli vault delete` leaves no `.backup` or `.tmp` behind.

## Resolution

**Item 1 done; item 2 won't fix, risk accepted 2026-09-17.** The finding is
closed on that basis, not because the rollback window was shut.

Item 1 was closed by deletion rather than by waiting for installs to upgrade.
The argument that made it easy: since the curve migration in
[13](13-sync-command-authentication.md) landed 2026-09-17, the v1 read path was
the **only** RSA-shaped code left in the library — `decryptKeysV1`, the PBES2
unwrap inside it, and `decryptSymmetricV1`. Deleting it removed RSA and
node-forge from favalib entirely, rather than merely closing the downgrade
window. And the migration it replaced was not cheap: it minted a fresh keypair,
so every peer had to pair again anyway. Against that, an export and an import
asks the user for one extra step and costs the library a whole crypto stack it
no longer has to keep correct.

What remains is the rollback window that has nothing to do with versions: a
`.backup` copy, or any snapshot of the storage, replayed over a current vault of
the **same** version. Nothing in that change touches it, and nothing will.

### Why item 2 is won't fix

Rolling a vault back requires **write** access to the storage the vault lives
in. An attacker with that already has read access to the same bytes, and on the
CLI — the only place a `.backup` exists — they are also on the machine where
`keytar` holds the password (`11-threat-model.md`, "the CLI weakens its own
model"). At that point the vault is lost by routes far shorter than a rollback:
read the blob and grind it offline, or just unlock it. Availability and
integrity of a file an attacker can rewrite at will are not properties this
design was ever going to hold, and the counter would not restore them — it turns
a silent revert into a refusal to open, which is a different failure, not an
averted one.

What the counter would genuinely buy is detection of a _quiet_ revert — an
attacker who wants the old TOTP seeds back without the user noticing. That is
real, and it is narrow enough not to justify a monotonic counter in two storage
media, a second thing that can desynchronise and lock a user out of their own
vault (a restored filesystem backup, a synced folder, a machine reimaged with an
older keychain), and a PWA story that depends on [16](16-server-authentication.md).
The cost lands on every honest user; the benefit lands only where the attacker
already won.

This is a deliberate scope boundary, not an oversight. If it is ever revisited,
the trigger would be the vault gaining a medium that is _already_ monotonic and
_already_ load-bearing — a server-side authenticated state from
[16](16-server-authentication.md), say — so the counter rides along instead of
being a new mechanism to keep correct.
