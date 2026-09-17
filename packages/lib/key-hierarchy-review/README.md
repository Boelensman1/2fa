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

| #                                   | Finding                                       | Verdict                  | Priority | Status             |
| ----------------------------------- | --------------------------------------------- | ------------------------ | -------- | ------------------ |
| [01](01-kdf-parameters.md)          | Argon2id parameters                           | weak                     | P0       | done               |
| [02](02-ciphertext-authenticity.md) | Vault ciphertext is unauthenticated           | broken                   | P0       | done               |
| [03](03-storage-versioning.md)      | `storageVersion` is write-only                | weak                     | P0       | done               |
| [04](04-key-rotation.md)            | No rotation; `changePassword` revokes nothing | weak                     | P1       | open               |
| [05](05-load-path-validation.md)    | Load path skips the entry validators          | weak                     | P1       | open               |
| [06](06-crypto-test-coverage.md)    | Nothing pins the KDF or the stored format     | weak                     | P1       | done               |
| [07](07-session-key-api.md)         | Extension stores the raw master password      | untidy                   | P2       | open               |
| [18](18-anti-rollback.md)           | Rollback to an earlier vault is undetectable  | weak                     | P1       | open               |
| [08](08-whole-vault-blob.md)        | Whole-vault blob vs per-item                  | **sound**                | —        | closed — no action |
| [09](09-iv-handling.md)             | IV handling                                   | **sound**                | —        | closed — no action |
| [10](10-rsa-layer.md)               | Why the RSA layer exists                      | **sound but incidental** | —        | closed — no action |

[11 — threat model](11-threat-model.md) is reference, not an action item: what
each layer does and does not defend against.

## Out of scope — sync layer

Hit while verifying the above, verified first-hand, and left **unranked against
the table above on purpose** — ranking them would imply a plan that has not been
made. [12](12-sync-findings-index.md) is the group index and explains what this
review did and did not do with them.

| #                                       | Finding                                         | Verdict                             | Status |
| --------------------------------------- | ----------------------------------------------- | ----------------------------------- | ------ |
| [13](13-sync-command-authentication.md) | Sync commands have no sender authentication     | broken                              | open   |
| [14](14-sync-device-injection.md)       | Unvalidated sync-device injection               | broken — most severe found anywhere | open   |
| [15](15-sync-replay-protection.md)      | Replay protection is bypassable by construction | broken                              | open   |
| [16](16-server-authentication.md)       | The sync server authenticates nothing           | weak by design, one real hijack     | open   |
| [17](17-synckey-salt.md)                | `createSyncKey`'s salt is a public device id    | untidy                              | open   |

`14` is the one to read first: combined with `13` it means an attacker can have
every newly enrolled TOTP seed encrypted to them, silently.

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
  owns the wider downgrade-then-migrate window that stays open while the v1 read
  path exists.
- **`10`'s amendment** — the at-rest RSA self-wrap has two costs this review did
  not weigh: it is what made the vault ciphertext forgeable by anyone holding
  the device's public key (the reason `02` needed a password-keyed MAC at all),
  and it is why a PBES2/AES-CBC blob is still in the hierarchy. `10`'s Decision
  to keep the RSA layer stands.

Remaining, in order: `04`, `05`, `07`, `18`. Whoever raises the KDF parameters
again must move the policy assertion in `kdf-vectors.test.ts` to a v3 vector and
leave **both** existing anchors beside it; the v1 anchor survives until the v1
read path itself is deleted (`18`, item 1).

## The verified hierarchy

As of `storageVersion: 2`. The v1 chain is unchanged from what is described
below it, and is still read by the named legacy path.

```
master password
  │   zxcvbn score ≥ 3 enforced — now BEFORE createKeys() runs (10-rsa-layer.md)
  ▼
argon2id (hash-wasm)
  salt = base64(16 CSPRNG bytes), used as a 24-byte UTF-8 string
  m = 64 MiB, t = 3, p = 4, len = 64  →  passwordHash (128 hex chars)
  parameters recorded per vault in LockedRepresentation.kdf
  ├────────────────────────────────────────────────┐
  ▼                                                ▼
PBES2 (PBKDF2 + AES-256-CBC), passphrase =    HKDF-SHA256(hex-DECODED
  passwordHash                                  passwordHash, salt,
  → RSA-4096 private key                        'favalib:envelope-mac:v2')
  ▼                                              → macKey
RSA-OAEP, MGF1 = SHA-256                         ▼
  unwraps encryptedSymmetricKey — wrapped      HMAC-SHA256 over every other
  to *this device's own* public key              LockedRepresentation field
  → symmetricKey (AES-256, base64)             → envelopeMac
  ▼                                              │
AES-256-GCM, fresh 12-byte CSPRNG nonce,         │  this is the layer that
  128-bit tag, bound to AAD                      │  authenticates the vault to
  format: "v2:" base64(nonce) ":"                │  the PASSWORD holder rather
          base64(ciphertext||tag)                │  than to whoever chose the
  AAD = storageVersion, salt, kdf,               │  symmetric key above
        SHA-256(encryptedPrivateKey)             │
  → encryptedVaultState = JSON.stringify(VaultState)
```

`LockedRepresentation` (`interfaces/Vault.mts`) = `{encryptedPrivateKey,
encryptedSymmetricKey, salt, encryptedVaultState, libVersion, storageVersion,
kdf, envelopeMac}`.

**Not GCM everywhere**: `encryptedPrivateKey` is still PBES2/AES-256-CBC, and
`decryptKeys` still distinguishes its failure modes. See
[10](10-rsa-layer.md)'s amendment — that blob exists only because the DEK is
routed through an RSA private key that must itself be stored encrypted.

Five details that are easy to get wrong:

1. **The whole hierarchy is per-device, not per-vault.** Each device runs its own
   `createKeys` and holds its own password, salt, RSA keypair and symmetric key.
   Only _entries_ and _public keys_ sync between devices. This is the most
   consequential fact in the review — it is why [04](04-key-rotation.md) is cheap.
2. **The symmetric key is wrapped to the device's own public key.** The RSA layer
   is a self-wrap for the at-rest path; it is a genuine peer-to-peer key only on
   the sync path.
3. **OAEP uses SHA-1** on both providers. Verified: node's default-padding
   `privateDecrypt` accepts a forge `'RSA-OAEP'` ciphertext, and forcing
   `oaepHash: 'sha256'` fails. Cross-provider interop locks this in.
4. **The argon2 salt is the base64 _string_**, passed to hash-wasm as 24 UTF-8
   bytes, not the 16 raw bytes. Harmless (128 bits of entropy either way). Note
   the MAC key derivation goes the other way: its input keying material is the
   **hex-decoded** password hash, 64 raw bytes rather than 128 characters. Both
   readings are plausible and diverge silently between providers, so
   `tests/CryptoProviders/envelope-mac.test.ts` pins it.
5. **`libVersion` was the hardcoded literal `'0.0.1'`** until
   [03](03-storage-versioning.md); it now tracks package.json and is covered by
   the envelope MAC, but still never gates a load.

**`LockedRepresentation` never leaves the device.** No wire message carries one;
the server persists only a queue of `{commandId, deviceId, encryptedCommand,
encryptedSymmetricKey}` (`packages/server/migrations/001_unsendSyncCommands.ts`).
Storage sinks are `vault.json` + `vault.json.backup` for the CLI, and the
`localStorage` key `lockedRepresentation` for the PWA. So the at-rest format has
**no peer-compatibility constraint** — there is no "peer on an older favalib"
problem, only a same-device downgrade problem, which is what
[03](03-storage-versioning.md) fixes.

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
