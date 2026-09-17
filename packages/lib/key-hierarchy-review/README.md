# favalib key hierarchy — security design review

Reviewed 2026-09-16 against `main` at c28f591 (extension findings from the
`app-extension` branch, noted where relevant).

Scope: the chain from master password down to vault plaintext —
`src/platformProviders/{browser,node}/cryptoLib.mts`,
`src/subclasses/PersistentStorageManager.mts`, `src/interfaces/Vault.mts`, and
the load path in `src/utils/creationUtils.mts`. Compared against published
password-manager architecture (Bitwarden's documented hierarchy), RFC 9106 and
OWASP argon2id guidance. No Bitwarden source was consulted or copied.

All timings were measured on a container CPU with the repo's own `hash-wasm`
and `node-forge`; they are relative indicators, not absolute guarantees.

## Status

Each finding is one file. Update the **Resolution** section at the bottom of a
file as work lands, and change its `Status:` line, the row here and the box in
[TODO.md](TODO.md) — the short checklist of what is fixed and what is left — to
match.

| #                                   | Finding                                       | Verdict                  | Priority | Status              |
| ----------------------------------- | --------------------------------------------- | ------------------------ | -------- | ------------------- |
| [01](01-kdf-parameters.md)          | Argon2id parameters                           | weak                     | P0       | done                |
| [02](02-ciphertext-authenticity.md) | Vault ciphertext is unauthenticated           | broken                   | P0       | done                |
| [03](03-storage-versioning.md)      | `storageVersion` is write-only                | weak                     | P0       | done                |
| [04](04-key-rotation.md)            | No rotation; `changePassword` revokes nothing | weak                     | P1       | done                |
| [05](05-load-path-validation.md)    | Load path skips the entry validators          | weak                     | P1       | done                |
| [06](06-crypto-test-coverage.md)    | Nothing pins the KDF or the stored format     | weak                     | P1       | done                |
| [07](07-session-key-api.md)         | Extension stores the raw master password      | untidy                   | P2       | done                |
| [18](18-anti-rollback.md)           | Rollback to an earlier vault is undetectable  | weak                     | P1       | open                |
| [08](08-whole-vault-blob.md)        | Whole-vault blob vs per-item                  | **sound**                | —        | closed — no action  |
| [09](09-iv-handling.md)             | IV handling                                   | **sound**                | —        | closed — no action  |
| [10](10-rsa-layer.md)               | Why the RSA layer exists                      | **sound but incidental** | —        | closed — superseded |

[11 — threat model](11-threat-model.md) is reference, not an action item: what
each layer does and does not defend against.

## Out of scope — sync layer

Hit while verifying the above, verified first-hand, and left **unranked against
the table above on purpose** — ranking them would imply a plan that has not been
made. [12](12-sync-findings-index.md) is the group index and explains what this
review did and did not do with them.

| #                                       | Finding                                         | Verdict                             | Status |
| --------------------------------------- | ----------------------------------------------- | ----------------------------------- | ------ |
| [13](13-sync-command-authentication.md) | Sync commands have no sender authentication     | broken                              | done   |
| [14](14-sync-device-injection.md)       | Unvalidated sync-device injection               | broken — most severe found anywhere | open   |
| [15](15-sync-replay-protection.md)      | Replay protection is bypassable by construction | broken                              | done   |
| [16](16-server-authentication.md)       | The sync server authenticates nothing           | weak by design, one real hijack     | open   |
| [17](17-synckey-salt.md)                | `createSyncKey`'s salt is a public device id    | untidy                              | open   |

`13` and `15` landed 2026-09-17 and took the asymmetric layer with them; see
`13` first, then [10](10-rsa-layer.md)'s amendment. `14` is the one still worth
reading closely: it is narrower than it was — enrolment is no longer open to
anyone holding a public key — but a trusted peer can still enrol anything, and
nothing surfaces a new device to the user.

**Status vocabulary:** `open` · `in progress` · `done` · `closed — no action`
(reviewed, deliberately nothing to do).

## Order of work

`03` and `06` landed 2026-09-16 as the prerequisites, and **`01` and `02`
shipped together the same day as `storageVersion: 2`**, carrying the three
actionable items from `10` with them. The stored format is now v2: argon2id at
m = 64 MiB / t = 3 / p = 4, AES-256-GCM with length-prefixed additional
authenticated data, RSA-OAEP with MGF1-SHA-256, and an `envelopeMac` keyed from
the password hash. A v1 vault is read through a named legacy path and
transparently re-wrapped on unlock.

Two things came **out** of that work rather than into it, and both are open:

- **`18`** — rollback. `02` claimed the AAD binding stopped the
  `vault.json.backup` swap; it does not, and neither does the MAC, because both
  are functions of an envelope that was valid when it was written. `18` also
  owned the wider downgrade-then-migrate window that stayed open while the v1
  read path existed — closed 2026-09-17 by deleting that read path, leaving
  `18` open for the rollback half alone.
- **`10`'s amendment** — the at-rest RSA self-wrap has two costs this review did
  not weigh: it is what made the vault ciphertext forgeable by anyone holding
  the device's public key (the reason `02` needed a password-keyed MAC at all),
  and it is why a PBES2/AES-CBC blob is still in the hierarchy. `10`'s Decision
  to keep the RSA layer stands.

`04` landed 2026-09-17: `changePassword` now draws a fresh salt and a fresh
symmetric key, and the library emits `FavaLibEvent.PasswordChanged` so an
embedder can drop anything it cached. The RSA keypair is still not rotated —
peers hold the public key — so full revocation remains re-pairing. The one part
of `04` left open is its extension half, which has no code in this tree.

**`05` landed the same day**: every value entering the vault from storage or
from a peer is now shape-checked at ingest. It refuses rather than drops, which
reverses what that file originally proposed — the reasoning is in it. It also
closed the `JSON.parse`/`SyntaxError` item `03` deferred, and took the shape half
of `14` with it without closing `14`.

`07` landed 2026-09-17, library half only: `favalib` now exports an unlocked
session — the secrets a password unlock derives — and rehydrates a `FavaLib`
from it with no argon2id and no key unwrapping. Everything else is read back
from the `LockedRepresentation`, and a stale session is refused by the envelope
MAC rather than by a counter, because `04` rotates the MAC key. The vault state
it decrypts goes through `05`'s validators, the same as the password path. The
blob is plaintext key material under a documented storage contract
(memory-backed, process-lifetime, nothing else): wrapping it would need a key
with a different lifetime, and there is none. `CryptoError` is exported now, so
a consumer can branch on "session unusable" without matching on a message
string. Two things it is **not**: freshness — a stale session with the stale
vault it was exported beside still opens (`18`) — and confidentiality. The
extension half is open, and is one commit on the `app-extension` branch
together with `04`'s.

**`13` and `15` landed the same day, and they moved the hierarchy under it.**
Sync commands are signed by the sending device and refused unless a peer
currently in the vault's device list signed them, for this recipient, under this
command id; the record of what has been applied is now persisted and bounded.
Getting there meant replacing the asymmetric layer — RSA-OAEP cannot sign, and
the library had no signing path — so X25519 and Ed25519 are in, `@noble/curves`
is shared by both providers, the at-rest self-wrap and the PBES2 blob are gone,
and [10](10-rsa-layer.md)'s Decision is reversed. The server was not touched and
its tests pass unedited. `07`'s session blob got smaller as a result: both
public keys are pure functions of the secret keys now, so it carries neither,
and `SESSION_VERSION` is 2 — the one version constant that was bumped rather
than redefined, because refusing a live session costs a single password prompt.

**Storage version 2 was redefined rather than superseded.** Every install in the
wild is on version 1 and no version 2 vault had ever been written outside this
repository, so `STORAGE_VERSION`, `COMMAND_VERSION` and `PAIRING_VERSION` keep
their values and only their documentation moved. The rule, stated once in
`version.mts`: a format that has not shipped is redefined in place, not
re-versioned. The one visible cost is that a v1 vault's migration now mints a
fresh keypair, so paired devices have to pair again — stated to the user rather
than engineered around, because the alternative authenticates new keys with the
primitive `13` says authenticates nothing. (Amended 2026-09-17: that cost is
what made the migration not worth keeping. It was deleted instead; a v1 vault is
refused, and the entries cross as an export. Paired devices still have to pair
again, so nothing was lost that the migration preserved.)

Remaining, in order: `18`, now down to its rollback half. Whoever raises the KDF
parameters again must move the policy assertion in `kdf-vectors.test.ts` to a v3
vector and leave **both** existing anchors beside it — a vault records the
parameters it was written with and must still open under them. (Amended
2026-09-17: the v1 read path is deleted, which took the last RSA code in the
library with it. The cheap anchor stayed regardless: `createSyncKey` derives
with those same numbers.)

## The verified hierarchy

As of `storageVersion: 2`, **as redefined on 2026-09-17** by
[13](13-sync-command-authentication.md) — the RSA layer is gone. The v1 chain is
unchanged (argon2id at the v1 parameters → PBES2-wrapped RSA-4096 →
RSA-OAEP/MGF1-SHA-1 → AES-256-CBC) and is still read by the named legacy path,
which is now the only RSA code in the library.

```
master password
  │   zxcvbn score ≥ 3 enforced — BEFORE createKeys() runs (10-rsa-layer.md)
  ▼
argon2id (hash-wasm)
  salt = base64(16 CSPRNG bytes), used as a 24-byte UTF-8 string
  m = 64 MiB, t = 3, p = 4, len = 64  →  passwordHash (128 hex chars)
  parameters recorded per vault in LockedRepresentation.kdf
  │
  ├─ HKDF-SHA256(hex-DECODED passwordHash, salt, 'favalib:key-wrap:v2')
  │    → AES-256-GCM seals {X25519 secret key, Ed25519 secret key}
  │    → encryptedSecretKeys        (both public keys are DERIVED on unlock)
  │
  ├─ HKDF-SHA256(…, 'favalib:dek-wrap:v2')
  │    → AES-256-GCM seals the symmetric key
  │    → encryptedSymmetricKey      (nothing is wrapped to a public key)
  │
  └─ HKDF-SHA256(…, 'favalib:envelope-mac:v2')  → macKey
       → HMAC-SHA256 over every other LockedRepresentation field
       → envelopeMac
  ▼
symmetricKey (AES-256, base64)
  ▼
AES-256-GCM, fresh 12-byte CSPRNG nonce, 128-bit tag, bound to AAD
  format: "v2:" base64(nonce) ":" base64(ciphertext||tag)
  AAD = storageVersion, salt, kdf, SHA-256(encryptedSecretKeys)
  → encryptedVaultState = JSON.stringify(VaultState)
```

On the sync path the same two keypairs do the work the RSA one used to:

```
per command, per recipient
  ephemeral X25519 keypair
    → ECDH to the recipient's public key
    → HKDF-SHA256, info binds (ephemeral public key, recipient public key)
    → AES-256-GCM over the command's symmetric key
    → encryptedSymmetricKey = "v2:" epk ":" nonce ":" ct||tag
  Ed25519 over (commandId, fromDeviceId, toDeviceId, payload)
    → signature, carried INSIDE the ciphertext with the sender's id
    → refused unless a device currently in this vault's list signed it
```

`LockedRepresentation` (`interfaces/Vault.mts`) = `{encryptedSecretKeys,
encryptedSymmetricKey, salt, encryptedVaultState, libVersion, storageVersion,
kdf, envelopeMac}`.

**AES-GCM everywhere, at last.** The PBES2/AES-256-CBC blob is gone with the RSA
layer it existed for; see [10](10-rsa-layer.md)'s amendment. Since the v1 read
path was deleted on 2026-09-17, AES-256-GCM is the only cipher in the library.

Five details that are easy to get wrong:

1. **The whole hierarchy is per-device, not per-vault.** Each device runs its own
   `createKeys` and holds its own password, salt, keypairs and symmetric key.
   Only _entries_ and _public keys_ sync between devices. This is the most
   consequential fact in the review — it is why [04](04-key-rotation.md) was
   cheap.
2. **Two keypairs, not one, and nothing self-wraps.** X25519 seals, Ed25519
   signs, and both are 32 base64-encoded bytes — so nothing but the field name
   and the branded type tells them apart. The at-rest path no longer uses either
   of them: both seals are under password-derived keys, which is what closed
   [02](02-ciphertext-authenticity.md)'s forgery at its source.
3. **The curve code is shared by both providers** (`@noble/curves`, in
   `platformProviders/shared/curves.mts`), where the RSA layer was implemented
   twice — node-forge in the browser, OpenSSL in node. That split is what
   produced the OAEP MGF1 hazard; there are no parameters left to mismatch. The
   symmetric half is still per-provider, and still pinned by
   `tests/CryptoProviders`.
4. **The argon2 salt is the base64 _string_**, passed to hash-wasm as 24 UTF-8
   bytes, not the 16 raw bytes. Harmless (128 bits of entropy either way). Note
   the three HKDF derivations go the other way: their input keying material is
   the **hex-decoded** password hash, 64 raw bytes rather than 128 characters.
   Both readings are plausible and diverge silently between providers, so
   `tests/CryptoProviders/envelope-mac.test.ts` pins it.
5. **`libVersion` was the hardcoded literal `'0.0.1'`** until
   [03](03-storage-versioning.md); it now tracks package.json and is covered by
   the envelope MAC, but still never gates a load.

**`LockedRepresentation` never leaves the device.** No wire message carries one;
the server persists only a queue of `{commandId, deviceId, encryptedCommand,
encryptedSymmetricKey}` (`packages/server/migrations/001_unsendSyncCommands.ts`).
Storage sinks are `vault.json` + `vault.json.backup` for the CLI, and the
`localStorage` key `lockedRepresentation` for the PWA. Since
[07](07-session-key-api.md) there is a second artifact a consumer may hold: an
exported unlocked session, which is plaintext key material and belongs only in
memory-backed, process-lifetime storage. So the at-rest format has
**no peer-compatibility constraint** — there is no "peer on an older favalib"
problem, only a same-device downgrade problem, which is what
[03](03-storage-versioning.md) fixes. The two formats that _do_ carry that
constraint are the sync command and the add-device pairing payload; see the
amendment on [03](03-storage-versioning.md) for the latter.

## What this review could not verify

- **GPU/ASIC argon2 throughput at a 512 KiB working set.** Not measured. The
  11×/192× multipliers in [01](01-kdf-parameters.md) are the area-time model;
  the direction is solid, the magnitudes are modelled.
- **Real password entropy behind the zxcvbn score-3 gate.** The 10¹⁰-guess /
  ~$4k anchor is an assumption, stated as one.
- **Whether `browser.storage.session` resists a compromised browser process.**
  Assumed not.
- The extension analysis is from the **`app-extension` branch**; `main` has a
  bare WXT skeleton that does not import favalib at all.
