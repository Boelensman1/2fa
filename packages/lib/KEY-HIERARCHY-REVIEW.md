# favalib key hierarchy — security design review

Reviewed 2026-09-16 against `main` at c28f591 (extension findings from the
`app-extension` branch, noted where relevant).

Scope: the chain from master password down to vault plaintext —
`src/platformProviders/{browser,node}/cryptoLib.mts`,
`src/subclasses/PersistentStorageManager.mts`, `src/interfaces/Vault.mts`,
and the load path in `src/utils/creationUtils.mts`. Compared against published
password-manager architecture (Bitwarden's documented hierarchy), RFC 9106 and
OWASP argon2id guidance. No Bitwarden source was consulted or copied.

All timings were measured on a container CPU with the repo's own `hash-wasm`
and `node-forge`; they are relative indicators, not absolute guarantees.

| Thread                            | Verdict                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| 1. KDF parameters                 | **Weak** — and strictly dominated, which is the sharp part |
| 2a. Whole-vault blob              | **Sound — leave it alone**                                 |
| 2b. Unauthenticated AES-CBC       | **Broken** — the most serious in-scope finding             |
| 2c. IV handling                   | **Sound**                                                  |
| 3. No rotation / `changePassword` | **Weak**, but far cheaper to fix than assumed              |
| 4. The RSA layer                  | **Sound but incidental** — not weak                        |

---

## 1. The verified hierarchy

```
master password
  │   zxcvbn score ≥ 3 enforced (creationUtils.mts:81)
  │   — but AFTER createKeys() runs, see §2 thread 4
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
   consequential fact in the review — it makes thread 3 much cheaper.
2. **The symmetric key is wrapped to the device's own public key.** The RSA layer
   is a self-wrap for the at-rest path; it is a genuine peer-to-peer key only on
   the sync path.
3. **OAEP uses SHA-1** on both providers. Verified: node's default-padding
   `privateDecrypt` accepts a forge `'RSA-OAEP'` ciphertext, and forcing
   `oaepHash: 'sha256'` fails. Cross-provider interop locks this in.
4. **The argon2 salt is the base64 _string_**, passed to hash-wasm as 24 UTF-8
   bytes, not the 16 raw bytes. Harmless (128 bits of entropy either way).
5. **`libVersion` is the hardcoded literal `'0.0.1'`** (`FavaLib.mts:55`), not read
   from package.json. Every vault ever written carries `0.0.1`.

**`LockedRepresentation` never leaves the device.** No wire message carries one;
the server persists only a queue of `{commandId, deviceId, encryptedCommand,
encryptedSymmetricKey}` (`packages/server/migrations/001_unsendSyncCommands.ts`).
Storage sinks are `vault.json` + `vault.json.backup` for the CLI, and the
`localStorage` key `lockedRepresentation` for the PWA. This matters enormously
for migration cost — see §4.

---

## 2. Per-thread verdicts

### Thread 1 — KDF parameters: weak

There is **no comment, doc or rationale anywhere in the repo** for these
parameters. `grep` for `deliberately|tiny|memorySize|argon` across all sources
finds only the bare call sites.

`parallelism: 1, iterations: 256, memorySize: 512` is hash-wasm's README example
copied verbatim — including its `// use 512KB memory` — with only `hashLength`
changed from 32 to 64. `git log -L` on the block shows they date to the initial
commit and have never been revisited. This is a demo snippet, not a considered
tradeoff.

Measured (`hash-wasm`, single-threaded):

| Parameters                               | Defender latency | Area-time cost (m²·t) | vs current |
| ---------------------------------------- | ---------------- | --------------------- | ---------- |
| **current** — 512 KiB, t=256             | **134 ms**       | 6.7e7                 | 1×         |
| OWASP floor — 19 MiB, t=2                | **54 ms**        | 7.6e8                 | 11×        |
| 64 MiB, t=2, p=1                         | 186 ms           | 8.6e9                 | 128×       |
| **Bitwarden default — 64 MiB, t=3, p=4** | **259 ms**       | 1.29e10               | **192×**   |
| 128 MiB, t=1                             | 225 ms           | 1.7e10                | 257×       |

The finding is not "these are below guidance". It is that **they are strictly
dominated**: OWASP's absolute floor costs the defender less than half the wall
clock (54 ms vs 134 ms) while costing the attacker 11× more. No tradeoff is being
made here in either direction. 512 KiB also fits inside the L2 cache of every
modern core, so argon2's memory-hardness — its entire reason for existing —
contributes nothing; the function degenerates to pure compute at cache speed,
which is exactly the regime GPUs and ASICs parallelise.

**Offline grind cost.** Per-guess work is one argon2id call (the PBES2 inner
PBKDF2 is irrelevant — its input is already a 64-byte high-entropy hash). At
134 ms/guess a 64-core node does ~478 guesses/s; ~$4k of spot CPU exhausts 10¹⁰
guesses, roughly where a zxcvbn-score-3 password sits. GPU throughput was **not
measured** — the 11×/192× figures are the standard area-time model, not
benchmarks. The direction is not in doubt (at a 512 KiB working set an attacker
fits thousands of instances in cache; at ≥19 MiB the GPU advantage largely
evaporates) but treat the multipliers as modelled, not measured.

**Does the MV3 service worker justify 512 KiB?** Partly, and it is self-inflicted.
On the `app-extension` branch, `lib/ioc/entities/VaultContainer.ts` persists **the
raw master password** to `browser.storage.session`, and on every worker eviction —
~30s idle under MV3 — `restoreSession()` replays a full `unlock()`: argon2 plus
forge `decryptRsaPrivateKey`. So unlock is the hot path, not the rare one. That is
a real argument for restraint, and the file's own doc comment already names the
fix: _"The clean fix is an 'export/import unlocked session' api in favalib."_ Ship
that and the objection disappears. Even without it, 259 ms on a background worker
restart is acceptable. WASM memory is not a constraint: 1 GiB succeeded in
testing, and `wxt.config.ts` already carries the `'wasm-unsafe-eval'` CSP
carve-out.

**The absent parameter record is a defect, and it is the blocking one.**
`LockedRepresentation` stores `salt`, `libVersion`, `storageVersion` and nothing
about the KDF, so parameters cannot be varied per vault and cannot be upgraded.
Worse: **nothing in the test suite pins them.** There is no KDF test vector and no
checked-in fixture of a real encrypted vault — every test builds a fresh one.
Changing `iterations` today breaks every existing vault with a fully green
`make test`. That is the most dangerous single fact in this review.

### Thread 2a — whole-vault blob: sound, leave it

A TOTP vault is tens to low hundreds of entries of a few hundred bytes each;
re-encrypting it on every write costs nothing measurable. Per-item encryption
exists in Bitwarden to serve partial sync and very large vaults, neither of which
applies here. And the granular path already exists where it matters: sync
encrypts **one ephemeral AES key per command per peer**
(`SyncManager.mts:872-885`), so handing one entry to a peer never requires handing
over the whole vault. No change recommended.

### Thread 2b — no authenticity on the vault ciphertext: broken

Confirmed by exhaustive grep across `packages/lib/src` and `packages/server/src`:
**no HMAC, no AEAD tag, no checksum, no signature on any ciphertext anywhere.**
The only failure signal is a PKCS#7 padding error. (OpenPGP is used for
export/import and _is_ authenticated — that path is fine.)

AES-CBC here gives confidentiality only. An attacker with write access to the
stored blob gets:

- **Rollback, with zero cryptanalysis.** Nothing binds a blob to a version or a
  time. The CLI writes `vault.json.backup` on every save
  (`app-cli/src/utils/loadVault.mts:22-47`) and never removes it — not even on
  `vault delete`. Copying the backup over `vault.json` silently reverts the vault:
  deleted TOTP seeds come back, newly added ones vanish. This is the most
  practical attack in the review and it requires a `cp`.
- **Free rewrite of plaintext block 0.** The IV is stored in the clear and the
  first 16 bytes of the plaintext are _exactly_ `{"vault":[{"id":` — measured, and
  exactly one AES block. XOR-ing the IV rewrites those 16 bytes arbitrarily.
  Keeping the remainder valid JSON constrains this (a demo tamper made
  `JSON.parse` throw), so it is a reliable corruption/DoS primitive rather than a
  clean injection one — but the key is never rotated, so every blob the device has
  ever written is under the same key and blocks can be spliced between them.
- **A padding oracle on the sync path.** `decryptSymmetric` throws on bad padding
  and `JSON.parse` throws on bad structure, distinguishably. A malicious server
  chooses ciphertexts and observes behaviour against `encryptedCommand` and
  `encryptedVaultData` (`SyncManager.mts:951-961`, `:809-811`). For the at-rest
  blob this matters less — an attacker who can feed you ciphertexts already has
  your file.

**Downstream does trust the decrypted JSON.** `creationUtils.mts:193-208` checks
only that `deviceId`, `sync.commandSendQueue` and `sync.devices` are present, then
passes `vaultState.vault` **unvalidated** into the `FavaLib` constructor. The
library already has `validateEntryFatal` (`utils/entryValidation.mts:75`) — it is
applied on the command path and _not_ on the load path. Same in
`SyncManager.importVaultState` (`:804-833`), which additionally loops
`vaultState.sync.devices` straight into `addSyncDevice` with no checks at all.

One piece of good news: `serverUrl` is **not** reachable from a forged vault state
— `importVaultState` ignores it and `setSyncServerUrl` enforces `wss://`.

### Thread 2c — IV handling: sound

Random 16 bytes from a CSPRNG per encryption on both providers (`randomBytes(16)`
/ `crypto.getRandomValues`), never reused, never derived, prepended to the
ciphertext. Correct. No change.

### Thread 3 — no rotation, and what `changePassword` revokes: weak

`changePassword` (`PersistentStorageManager.mts:194-221`) re-wraps the _same_
`privateKey` and `symmetricKey` and reuses `this.salt`, which is never reassigned
anywhere.

- **Against anyone who ever unlocked the vault, `changePassword` revokes
  nothing** — including for blobs written after the change. They hold the
  symmetric key; it encrypts every future save. Since reading anything required
  unwrapping that key, password compromise and key compromise travel together. Its
  one real benefit is narrow: someone holding a _stale copy_ of the blob and still
  grinding it does not get the new one for free.
- **Salt reuse is a real weakness, not untidiness.** `changePassword` is the
  post-compromise action. An attacker who has been grinding the old blob has
  computed `argon2id(salt, guess)` for every candidate tried; with the salt
  unchanged that entire precomputation transfers to the new blob at zero cost. A
  fresh salt invalidates all of it. The fix is one line.
- **Rotation is much cheaper than it looks.** Because the hierarchy is per-device
  (§1), **the symmetric key is purely local** — it never leaves the machine and no
  peer has ever seen it. Rotating it needs no peer coordination, no protocol
  change, and no migration: generate a new one, re-wrap under the device's own
  public key, re-encrypt the blob. Independently-versioned devices are simply not
  a constraint here. Rotating the **RSA keypair** _is_ expensive — peers hold the
  public key and the only distribution channel is an unauthenticated
  `AddSyncDeviceCommand` — so full revocation still means re-pairing devices.
- **Remediation story today: none**, short of a new vault. But note that
  re-enrolling every TOTP seed is unavoidable _once the seeds themselves have
  leaked_, regardless of what the crypto does. No key hierarchy fixes that. What
  rotation buys is closing the door on _future_ writes.
- **Extension angle:** because `browser.storage.session` holds the raw password
  rather than derived keys, a compromise there yields the password itself — worse
  than leaking keys (it is the input for every device, and users reuse passwords).
  `VaultContainer.lock()` clears it, but `changePassword` does not, so a stale
  password can outlive the change.

### Thread 4 — why the RSA layer exists: sound but incidental, not weak

- **Load-bearing for sync: genuinely yes.** Peers wrap per-command ephemeral AES
  keys to each other's RSA public keys (`SyncManager.mts:874-877`, `:997-1000`).
  The keypair has to exist.
- **For the vault at rest it is incidental.** The symmetric key is wrapped to the
  device's _own_ public key — a self-wrap cryptographically equivalent to wrapping
  it directly under `passwordHash`, just with more moving parts. The routing is
  historical, not motivated.
- **The cost is lower than folklore suggests.** node-forge RSA-4096 keygen measured
  a 394 ms median over 6 runs (218–614 ms), and the callback form favalib uses
  **yields to the event loop** — 21 event-loop ticks observed during one keygen, so
  it is not a blocking freeze. The repo's own 96–1776 ms figure
  (`vitest.config.ts`) is for node's native path. There is a long tail, and no app
  shows a spinner, but this is not an argument against the design.
- The OAEP failure mode is not a real risk: max plaintext is 470 bytes for
  RSA-4096/OAEP-SHA1 against a 44-byte key.
- **OAEP-SHA1 is an audit flag, not a break.** OAEP does not need collision
  resistance, so there is no practical attack — but it will fail a compliance
  review, and cross-provider interop pins it.
- **AEAD + a modern KEM would be the choice for a design starting today** — but
  keep the halves separate. Replacing CBC with an AEAD is a _real_ fix and is
  recommended below. Replacing RSA-4096/OAEP with X25519/HPKE is "would be nicer",
  not "is weak", and is expensive precisely because public keys are already
  distributed to peers with no re-keying story. Not recommended now.
- Two minor inefficiencies: node's `createKeys` runs argon2 **twice** (once to set
  the PKCS#8 passphrase, once inside the `decryptKeys` round-trip at
  `node/cryptoLib.mts:80-85`, used only to recover the plaintext key it could have
  exported directly), and `createNewFavaLibVault` calls `createKeys` _before_
  `validatePasswordStrength` (`creationUtils.mts:113` vs `:115`), so a weak
  password costs a full RSA-4096 keygen before being rejected.

---

## 3. Threat models

**Defended:**

- _Blob at rest, attacker has no password._ Confidentiality holds. The chain is
  sound in shape; only the KDF cost is under-set.
- _Malicious or compromised sync server reading vault contents._ Holds. Everything
  relayed is encrypted to keys the server never sees. JPAKE pairing uses a 60-byte
  CSPRNG secret (`SyncManager.mts:489-491`), so the pairing channel is not
  offline-attackable.
- _Forged vault state redirecting the sync server._ Holds — `serverUrl` is ignored
  on import.

**Not defended:**

- **Offline grind of a stolen `LockedRepresentation` — the threat that matters
  most here.** The only barrier is argon2id at 134 ms/guess with no effective
  memory hardness: ~11× below OWASP's floor and ~192× below Bitwarden's default on
  an area-time basis. The zxcvbn score-3 gate is doing real work and is the main
  reason this is "weak" rather than "broken". Note the CLI weakens its own model:
  `keytar` stores the _password_ on the same machine as `vault.json`, so a
  live-session attacker skips the grind entirely.
- **Tampering with the stored blob.** Undefended — no authenticity at all.
  Rollback via `vault.json.backup` needs no cryptanalysis.
- **Hostile content in a decrypted vault state.** Undefended — entries from disk
  and from peers bypass the validators that already exist.
- **Post-compromise recovery.** Undefended — no rotation, and `changePassword`
  revokes nothing.

**Outside the four threads, found while verifying them.** These are sync-layer,
not key-hierarchy, and two are individually more severe than anything above.
Flagged, not expanded — they deserve their own review:

1. **Sync commands have no sender authentication.** RSA-OAEP is a public operation
   and there is no signature, so anyone holding a device's public key can mint a
   well-formed command for it.
2. **Unvalidated sync-device injection.** `importVaultState` loops
   `vaultState.sync.devices` into `addSyncDevice` unchecked, and
   `AddSyncDeviceCommand.validate()` is a hardcoded `return true`
   (`Command/commands/AddSyncDeviceCommand.mts:56-59`). An injected attacker
   public key means every future `AddEntry` — every new TOTP secret — is encrypted
   to the attacker.
3. **Replay protection is bypassable by construction.** `processedCommandIds` is
   in-memory and keyed on the _server-supplied_ `commandId`, while the ciphertext
   deliberately drops its own id (`SyncManager.mts:882` vs `:965`). The server
   stores every blob durably and picks the ids. The `nonce` on eight message types
   is read by nobody.

---

## 4. Prioritised changes

Migration is cheaper than it first appears, because **`LockedRepresentation` is
purely local and never crosses the wire.** There is no "peer on an older favalib"
problem for the at-rest format — only a same-device downgrade problem (an older
build opening a newer blob), which is what P0-a fixes. P0-a through P0-c ship
together as `storageVersion: 2`.

**P0-a — make `storageVersion` load-bearing.** Today it is write-only; nothing
reads it, so an older lib opens a newer blob and re-saves it in the old shape —
silent downgrade and data loss. Add a read in `creationUtils.mts:172` that rejects
`storageVersion > PersistentStorageManager.storageVersion` with a clear error.
_Prerequisite for everything else. ~10 lines._

**P0-b — authenticate the vault ciphertext.** Move `encryptSymmetric` /
`decryptSymmetric` to AES-256-GCM (both providers already have it: WebCrypto and
node `createCipheriv`), binding `storageVersion` and `salt` as AAD. Keep CBC
decryption for reading v1. The wire format gains a third field. This kills the
rollback, the malleability and the padding oracle in one change — and the AAD
binding is what actually stops the `vault.json.backup` swap. _~60 lines across two
files, plus a v1 read path. Sync ciphertexts use the same functions, so this is
also a wire change — gate the sync side separately or version the command
payload._

**P0-c — record the KDF parameters, then raise them.** Add
`kdf: {algorithm, memorySize, iterations, parallelism, hashLength}` to
`LockedRepresentation`. Read it when present; default to the current values when
absent (that _is_ the v1 migration). Then set new vaults to **m=64 MiB, t=3,
p=4** — Bitwarden's default, 259 ms measured, 192× the current attacker cost. On a
successful v1 unlock, transparently re-wrap at v2 with a fresh salt and save.
_Type change, a branch in `generatePasswordHash`, and the re-wrap hook. Users see
one slightly slower unlock, once._

**P1-a — rotate salt and symmetric key in `changePassword`.** Generate a fresh
salt and a fresh symmetric key, re-encrypt the vault state under the new key,
re-wrap. Kills the precomputation transfer and makes `changePassword` actually
revoke against a stale-blob attacker. The symmetric key is local, so no peer
coordination is needed. _~20 lines — the best value in this list._ Also clear the
extension's session password on change.

**P1-b — validate entries on the load path.** Reuse the existing
`validateEntryFatal` (`utils/entryValidation.mts:75`) in `creationUtils.mts:193-208`
and in `importVaultState`. Drop-and-log rather than throw, matching the stated
policy for peer entries. _~15 lines, no format change._

**P1-c — pin the crypto in tests.** Add a KDF test vector (fixed password + salt +
params → expected hash) and a checked-in fixture of a real v1 vault that must
still open. Without these, any future parameter change breaks every existing vault
with a green suite. _Two small test files. Do this before P0-c._

**P2 — add an export/import-unlocked-session API to favalib.** Lets the extension
hold derived key material in `browser.storage.session` instead of the raw master
password, and removes the only real argument for a cheap KDF. The extension's own
`AGENTS.md` already asks for it. Its tests currently assert on
`session:vaultPassword`, so they change too. _Moderate; new public API on a
published package._

**Explicitly not recommended:**

- **Per-item encryption.** The single blob is right for this product.
- **Removing the RSA layer from the at-rest path.** Incidental, not weak; churn on
  a published package's stored format for no security gain.
- **Replacing RSA-4096/OAEP with X25519/HPKE.** Nicer, not needed, and expensive —
  peer public keys are already distributed with no re-keying story.
- **OAEP-SHA1 → SHA-256.** An audit flag with no practical attack, and changing it
  is a cross-device wire break. Revisit if a compliance requirement appears.
- **IV handling.** Already correct.
- The zxcvbn score-3 gate and the 60-byte JPAKE pairing secret are both good.

---

## 5. Verifying the work above

- `make -C packages/lib test` and `make -C packages/lib lint` after each item.
- **The fixture test from P1-c is the real gate**: a v1 vault written before the
  change must still open after it, on both providers.
- `tests/CryptoProviders/compare-node-browser.test.ts` must stay green — it is the
  cross-provider contract, and P0-b touches both providers.
- Re-measure unlock latency on the extension path after P0-c; `restoreSession()`
  runs on every MV3 worker boot.
- Manual: create a vault in the CLI, `changePassword`, confirm the salt in
  `vault.json` changed (P1-a); copy `vault.json.backup` over `vault.json` and
  confirm it is now rejected rather than silently accepted (P0-b).

## What this review could not verify

- **GPU/ASIC argon2 throughput at a 512 KiB working set.** Not measured. The
  11×/192× multipliers are the area-time model; the direction is solid, the
  magnitudes are modelled.
- **Real password entropy behind the zxcvbn score-3 gate.** The 10¹⁰-guess / ~$4k
  anchor is an assumption, stated as one.
- **Whether `browser.storage.session` resists a compromised browser process.**
  Assumed not.
- The extension analysis is from the **`app-extension` branch**; `main` has a bare
  WXT skeleton that does not import favalib at all.
