# 02 — The vault ciphertext is unauthenticated

**Verdict:** broken — the most serious in-scope finding
**Status:** done
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

Done 2026-09-16, shipped with [01](01-kdf-parameters.md) as `storageVersion: 2`,
and carrying the three items from [10](10-rsa-layer.md) that were only ever
deferred because they were wire breaks. A **clean break**: peers upgrade
together, the sync wire moves to the new envelope with no fallback, and only
the at-rest load path reads v1.

### What the ciphertext is authenticated to — read this before quoting the fix

**The vault ciphertext is now authenticated to the holder of the _password_.**
Saying "authenticated" without that qualifier would be wrong, and the AEAD
alone does not get you there. Three blobs, three different answers to "who
could have written this":

| blob                    | keyed by                                       | forgeable by                |
| ----------------------- | ---------------------------------------------- | --------------------------- |
| `encryptedPrivateKey`   | argon2id(password)                             | the password holder         |
| `encryptedSymmetricKey` | RSA-OAEP under the device's **own** public key | anyone with that public key |
| `encryptedVaultState`   | AES-256-GCM under that key + AAD               | whoever chose the key above |

The GCM tag proves only that the writer held the data encryption key — and that
key arrives via a **public-key** wrap. An attacker with write access to the file
who knows the device's public key can pick their own `K'`, compute
`OAEP(pub_self, K')`, encrypt an arbitrary vault state under it with a correctly
built AAD (every AAD input is cleartext in the file they are writing), leave
`encryptedPrivateKey` and `salt` untouched — and the victim's real password
opens it with every check passing. AAD cannot fix this: it binds fields to each
other, adds no secret, and an adversary who can produce the key produces the
matching AAD too.

That is not a tampering nuisance. The load path accepts the whole `VaultState`
with no external cross-check on any field — `vault`, `deviceId`, `sync.devices`
and `sync.serverUrl` all come from inside the blob — and `startResilver` is
still honoured unconditionally (`SyncManager.mts:424-429`, `// todo: check for
missing deviceIds`). The attacker would control where the device syncs and which
public keys it trusts.

So v2 adds an **`envelopeMac`**: HMAC-SHA256 over every other
`LockedRepresentation` field, keyed by HKDF-SHA256 over the password hash.
`tests/envelope-integrity.test.mts` builds exactly that forgery and asserts
first that the AEAD layer accepts it completely — the victim's own private key
unwraps the attacker's chosen key — and then that the MAC rejects it. That test
is the finding.

**Reachability, stated honestly:** the attacker needs the device's public key.
The server only relays it (`server.mts:88-98`, never stored) and it travels
encrypted under the JPAKE sync key, so the practical route is a compromised
peer, whose vault state carries it in `sync.devices`. The residual finding is
that vault integrity rested on the confidentiality of a value the design
otherwise treats as public — and the keypair is deliberately never rotated
([04](04-key-rotation.md)), so one leak would have been permanent.

A separate MAC was chosen over mixing the password hash into the content key,
which would have made the vault content underivable from the DEK alone and
given up the re-wrap-to-another-public-key affordance that is the reason
[10](10-rsa-layer.md) kept the RSA layer. A future recovery flow re-issues the
MAC instead.

### Rollback is NOT closed

The claim in "What to do" above — that the AAD binding is what stops the
`vault.json.backup` swap — **was wrong, and the fix does not make it true.** The
backup carries the same `salt`, `storageVersion` and `kdf` as the live file, so
any AAD derived from the envelope validates for both, and so does the MAC. An
AEAD cannot detect a rollback to a previously valid, complete file; that needs
external monotonic state. It is now [18](18-anti-rollback.md), which also
records the wider window the v1 read path opens while it exists.

What did close, all of it real: the IV-XOR rewrite of plaintext block 0 and
every bit-flip or splice; envelope forgery (above); the password-change splice
(below); the padding oracle on the sync path; and silent corruption.

### What landed

- **The v2 ciphertext envelope**, both providers:
  `v2:base64(nonce):base64(ciphertext||tag)`, AES-256-GCM, a **12-byte** nonce
  per [09](09-iv-handling.md) rather than the v1 path's 16, 128-bit tag.
  WebCrypto appends the tag itself, so node concatenates it to match. Both
  `decryptSymmetric` implementations throw one uniform
  `CryptoError('Could not decrypt data')` for every cause — bad tag, bad nonce,
  bad AAD, malformed base64, wrong key. Neither had a `try`/`catch` at all
  before.
- **`src/utils/canonical.mts`** — one length-prefixed canonical encoder behind
  the AAD for all four contexts (`vault`, `command`, `vaultdata`, `handshake`)
  and the MAC message. Length prefixes are not decoration: `commandId` is a
  uuidv4 only by default and on the receive path comes straight off the server
  payload as a bare string, `fromDeviceId` is stamped by the server, and
  `DeviceId` is a `Tagged<string>` with no runtime validation. Those are the
  adversary-influenced strings an AAD exists to defend against, and nothing
  authenticates the sender yet ([13](13-sync-command-authentication.md)). The
  four domain prefixes mean an at-rest blob can no longer be replayed as a sync
  payload or the reverse.
- **The at-rest AAD binds `SHA-256(encryptedPrivateKey)`.** `changePassword`
  reuses both the salt and the symmetric key, re-wrapping only the private key,
  so without this the DEK and the AAD are identical before and after a password
  change and a vault state lifted from a pre-change backup authenticates under
  the **new** password — silently restoring a deleted entry or a revoked sync
  device while the rotation appeared to work. The digest is hashed over the
  **exact stored bytes**: node writes PEM with `\n` and node-forge with
  `\r\n`, so normalising on one path and not the other would pass within a
  provider and fail across them. `fixtures.test.mts` opens a node-migrated vault
  in the browser and the reverse, which is where that would surface.
  Note this closes the splice, not same-password rollback — that is `18`.
- **`envelopeMac`** as described above. Verified **after** `decryptKeys` and
  **before** the vault state is decrypted, parsed or used: a wrong password
  produces a wrong MAC key too, so a MAC-first order would replace
  `'Invalid password'` with an indistinguishable integrity error in both the CLI
  and the browser. `decryptKeys`/`encryptKeys`/`createKeys` now return the MAC
  key from the password hash they already derived — a second derivation would
  cost a whole extra argon2 pass on every unlock. Comparison is constant-time
  (`timingSafeEqual`; an explicit byte loop in the browser).
- **The sync wire is GCM-only.** The v1 readers are named `decryptSymmetricV1`
  and `decryptKeysV1` and are reachable only from
  `loadFavaLibFromLockedRepesentation`; `decryptSymmetric` refuses anything
  without the `v2:` prefix. That, not the tag, is what actually removes the
  padding oracle rather than merely making the new path safe. **Caveat:**
  `encryptedPrivateKey` is still PBES2/AES-256-CBC and `decryptKeys` still
  distinguishes `ERR_OSSL_BAD_DECRYPT` from `ERR_OSSL_UNSUPPORTED`. There is no
  adaptive oracle against a local file, so this is not urgent — but the
  hierarchy in the README does not say "GCM everywhere", and [10](10-rsa-layer.md)
  now records that this blob exists only because the DEK is routed through an
  RSA private key that must itself be stored encrypted.
- **`receiveCommands` catches per command.** It maps inside a `Promise.all`, so
  now that decryption throws a uniform `CryptoError`, one stale or hostile
  command would have rejected the whole batch and taken `processRemoteCommands`
  and the ready event down with it. Dropping one is lossless: it is never
  reported in `syncCommandsExecuted`, so the server redelivers it.
- **`packages/server/migrations/002_clearV1SyncCommands.ts`** deletes the queued
  commands. Rows written before the upgrade are v1 CBC with SHA-1 OAEP wraps and
  no client can ever decrypt them; they have no TTL and are redelivered on every
  reconnect, so leaving them would make every client warn forever.
- **The v1 `commandSendQueue` is cleared during the migration** — it lives
  inside the at-rest vault state and holds the same undeliverable v1 payloads.
  Client-local, so the server migration does not cover it.
- **`favacli vault delete` now removes `vault.json.backup` and any stale
  `.tmp`.** Reduces the exposure in `18`; does not close it.

### Verified by mutation

| Mutation                                                 | Result                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| flip a byte of `encryptedVaultState` or of `envelopeMac` | load fails with the integrity error, not a `SyntaxError` or a padding error                             |
| HKDF `info` `…:v2` → `…:v3` in the node provider only    | `envelope-mac.test.ts` reddens by name, on both the cross-provider and the hex-decode assertions        |
| drop `SHA-256(encryptedPrivateKey)` from the at-rest AAD | `'binds the vault state to the encrypted private key'` reddens, alone                                   |
| drop the length prefix from the canonical encoder        | `vault-v2.json` reddens — reshaping the encoding is a storage break, and the frozen fixture is the gate |

`COMMAND_VERSION` is now `'2.0'`. That is bookkeeping, **not** the gate:
`commandVersionIsSupported` accepts _older_ majors
(`major <= currentCommandMajorVersion`), so a v1 peer's command fails earlier,
in decryption. The comment in [03](03-storage-versioning.md) calling it a
forward-compat hook still stands.
