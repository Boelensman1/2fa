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
file as work lands, and change its `Status:` line and the row here to match.

| #                                   | Finding                                       | Verdict                  | Priority | Status             |
| ----------------------------------- | --------------------------------------------- | ------------------------ | -------- | ------------------ |
| [01](01-kdf-parameters.md)          | Argon2id parameters                           | weak                     | P0       | open               |
| [02](02-ciphertext-authenticity.md) | Vault ciphertext is unauthenticated           | broken                   | P0       | open               |
| [03](03-storage-versioning.md)      | `storageVersion` is write-only                | weak                     | P0       | open               |
| [04](04-key-rotation.md)            | No rotation; `changePassword` revokes nothing | weak                     | P1       | open               |
| [05](05-load-path-validation.md)    | Load path skips the entry validators          | weak                     | P1       | open               |
| [06](06-crypto-test-coverage.md)    | Nothing pins the KDF or the stored format     | weak                     | P1       | open               |
| [07](07-session-key-api.md)         | Extension stores the raw master password      | untidy                   | P2       | open               |
| [08](08-whole-vault-blob.md)        | Whole-vault blob vs per-item                  | **sound**                | —        | closed — no action |
| [09](09-iv-handling.md)             | IV handling                                   | **sound**                | —        | closed — no action |
| [10](10-rsa-layer.md)               | Why the RSA layer exists                      | **sound but incidental** | —        | closed — no action |

Reference, not action items:

- [11 — threat model](11-threat-model.md) — what each layer does and does not defend.
- [12 — out-of-scope sync findings](12-out-of-scope-sync-findings.md) — three
  sync-layer findings hit while verifying the above. Two are individually more
  severe than anything in the table. They need their own review.

**Status vocabulary:** `open` · `in progress` · `done` · `closed — no action`
(reviewed, deliberately nothing to do).

## Order of work

`03` is a prerequisite for `01` and `02` — without a version gate an older
build opens a newer blob and re-saves it in the old shape. `06` should land
before `01`, because today a KDF parameter change breaks every existing vault
with a fully green `make test`. After that: `01` + `02` + `03` ship together as
`storageVersion: 2`, then `04`, `05`, `07`.

## The verified hierarchy

```
master password
  │   zxcvbn score ≥ 3 enforced (creationUtils.mts:81)
  │   — but AFTER createKeys() runs, see 10-rsa-layer.md
  ▼
argon2id (hash-wasm)
  salt = base64(16 CSPRNG bytes), used as a 24-byte UTF-8 string
  m = 512 KiB, t = 256, p = 1, len = 64  →  passwordHash (128 hex chars)
  browser/cryptoLib.mts:41-54 — node imports this same function (node/cryptoLib.mts:31)
  ▼
PBES2 (PBKDF2 + AES-256-CBC), passphrase = passwordHash
  node: PKCS#8 export w/ cipher (node/cryptoLib.mts:65-70)
  browser: forge.pki.encryptRsaPrivateKey (browser/cryptoLib.mts:255-261)
  → RSA-4096 private key
  ▼
RSA-OAEP, MGF1 = SHA-1 (verified empirically, both providers)
  unwraps encryptedSymmetricKey — wrapped to *this device's own* public key
  (node/cryptoLib.mts:75-78, browser/cryptoLib.mts:82)
  → symmetricKey (AES-256, base64)
  ▼
AES-256-CBC, fresh random 16-byte IV per encryption, no MAC / no tag
  wire format: base64(iv) + ":" + base64(ct)
  → encryptedVaultState = JSON.stringify(entire VaultState)
```

`LockedRepresentation` (`interfaces/Vault.mts:19-26`) = `{encryptedPrivateKey,
encryptedSymmetricKey, salt, encryptedVaultState, libVersion, storageVersion}`.

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
   bytes, not the 16 raw bytes. Harmless (128 bits of entropy either way).
5. **`libVersion` is the hardcoded literal `'0.0.1'`** (`FavaLib.mts:55`), not
   read from package.json. Every vault ever written carries `0.0.1`.

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
