# 02 — The vault ciphertext is unauthenticated

**Verdict:** broken — the most serious in-scope finding
**Status:** open
**Priority:** P0 (ships with [01](01-kdf-parameters.md) and
[03](03-storage-versioning.md) as `storageVersion: 2`)
**Touches:** `encryptSymmetric` / `decryptSymmetric` in both providers,
`src/utils/creationUtils.mts:193-208`, `packages/app-cli/src/utils/loadVault.mts`

## Finding

Confirmed by exhaustive grep across `packages/lib/src` and
`packages/server/src`: **no HMAC, no AEAD tag, no checksum, no signature on any
ciphertext anywhere.** The only failure signal is a PKCS#7 padding error.
(OpenPGP is used for export/import and _is_ authenticated — that path is fine.)

AES-CBC here gives confidentiality only. An attacker with write access to the
stored blob gets:

- **Rollback, with zero cryptanalysis.** Nothing binds a blob to a version or a
  time. The CLI writes `vault.json.backup` on every save
  (`app-cli/src/utils/loadVault.mts:22-47`) and never removes it — not even on
  `vault delete`. Copying the backup over `vault.json` silently reverts the
  vault: deleted TOTP seeds come back, newly added ones vanish. This is the most
  practical attack in the review and it requires a `cp`.
- **Free rewrite of plaintext block 0.** The IV is stored in the clear and the
  first 16 bytes of the plaintext are _exactly_ `{"vault":[{"id":` — measured,
  and exactly one AES block. XOR-ing the IV rewrites those 16 bytes arbitrarily.
  Keeping the remainder valid JSON constrains this (a demo tamper made
  `JSON.parse` throw), so it is a reliable corruption/DoS primitive rather than
  a clean injection one — but the key is never rotated
  ([04](04-key-rotation.md)), so every blob the device has ever written is under
  the same key and blocks can be spliced between them.
- **A padding oracle on the sync path.** `decryptSymmetric` throws on bad
  padding and `JSON.parse` throws on bad structure, distinguishably. A malicious
  server chooses ciphertexts and observes behaviour against `encryptedCommand`
  and `encryptedVaultData` (`SyncManager.mts:951-961`, `:809-811`). For the
  at-rest blob this matters less — an attacker who can feed you ciphertexts
  already has your file.

**Downstream does trust the decrypted JSON** — that is
[05](05-load-path-validation.md).

One piece of good news: `serverUrl` is **not** reachable from a forged vault
state — `importVaultState` ignores it and `setSyncServerUrl` enforces `wss://`.

## What to do

Move `encryptSymmetric` / `decryptSymmetric` to AES-256-GCM. Both providers
already have it (WebCrypto and node `createCipheriv`). Bind `storageVersion` and
`salt` as AAD — **the AAD binding is what actually stops the
`vault.json.backup` swap**, not the tag alone.

Keep CBC decryption for reading v1. The wire format gains a third field.

Cost: ~60 lines across two files, plus a v1 read path. Sync ciphertexts use the
same two functions, so this is **also a wire change** — gate the sync side
separately or version the command payload, otherwise a peer on an older favalib
cannot read a command from a newer one.

Worth doing alongside: have the CLI remove `vault.json.backup` on `vault delete`
(`app-cli/src/commands/vault/delete.mts:40`).

## How to verify

- Copy `vault.json.backup` over `vault.json` and confirm it is now rejected
  rather than silently accepted.
- A v1 vault must still open (fixture test from
  [06](06-crypto-test-coverage.md)).
- `tests/CryptoProviders/compare-node-browser.test.ts` must stay green — it is
  the cross-provider contract and this touches both providers.

## Resolution

_Not started._
