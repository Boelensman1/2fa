# 01 — Argon2id parameters

**Verdict:** weak — the sharpest issue in the key hierarchy
**Status:** done
**Priority:** P0 (ships with [02](02-ciphertext-authenticity.md) and
[03](03-storage-versioning.md) as `storageVersion: 2`; do
[06](06-crypto-test-coverage.md) first)
**Touches:** `src/platformProviders/browser/cryptoLib.mts:41-54`,
`src/platformProviders/node/cryptoLib.mts:31`, `src/interfaces/Vault.mts:19-26`

## Finding

There is **no comment, doc or rationale anywhere in the repo** for these
parameters. `grep` for `deliberately|tiny|memorySize|argon` across all sources
finds only the bare call sites.

`parallelism: 1, iterations: 256, memorySize: 512` is hash-wasm's README example
copied verbatim — including its `// use 512KB memory` — with only `hashLength`
changed from 32 to 64. `git log -L` on the block shows the values date to the
initial commit and have never been revisited. This is a demo snippet, not a
considered tradeoff.

Measured (`hash-wasm`, single-threaded, this container):

| Parameters                               | Defender latency | Area-time cost (m²·t) | vs current |
| ---------------------------------------- | ---------------- | --------------------- | ---------- |
| **current** — 512 KiB, t=256             | **134 ms**       | 6.7e7                 | 1×         |
| OWASP floor — 19 MiB, t=2                | **54 ms**        | 7.6e8                 | 11×        |
| 64 MiB, t=2, p=1                         | 186 ms           | 8.6e9                 | 128×       |
| **Bitwarden default — 64 MiB, t=3, p=4** | **259 ms**       | 1.29e10               | **192×**   |
| 128 MiB, t=1                             | 225 ms           | 1.7e10                | 257×       |

The finding is not "these are below guidance". It is that **they are strictly
dominated**: OWASP's absolute floor costs the defender less than half the wall
clock (54 ms vs 134 ms) while costing the attacker 11× more. No tradeoff is
being made here in either direction. 512 KiB also fits inside the L2 cache of
every modern core, so argon2's memory-hardness — its entire reason for existing
— contributes nothing; the function degenerates to pure compute at cache speed,
which is exactly the regime GPUs and ASICs parallelise.

### Offline grind cost

Per-guess work is one argon2id call (the PBES2 inner PBKDF2 is irrelevant — its
input is already a 64-byte high-entropy hash). At 134 ms/guess a 64-core node
does ~478 guesses/s; ~$4k of spot CPU exhausts 10¹⁰ guesses, roughly where a
zxcvbn-score-3 password sits.

GPU throughput was **not measured**. The 11×/192× figures are the standard
area-time model, not benchmarks. The direction is not in doubt — at a 512 KiB
working set an attacker fits thousands of instances in cache, and at ≥19 MiB the
GPU advantage largely evaporates — but treat the multipliers as modelled.

### Does the MV3 service worker justify 512 KiB?

Partly, and it is self-inflicted. On the `app-extension` branch,
`lib/ioc/entities/VaultContainer.ts` persists the **raw master password** to
`browser.storage.session`, and on every worker eviction — ~30s idle under MV3 —
`restoreSession()` replays a full `unlock()`: argon2 plus forge
`decryptRsaPrivateKey`. So unlock is the hot path, not the rare one.

That is a real argument for restraint, and the file's own doc comment already
names the fix: _"The clean fix is an 'export/import unlocked session' api in
favalib."_ That is [07](07-session-key-api.md). Ship it and the objection
disappears. Even without it, 259 ms on a background worker restart is
acceptable.

WASM memory is not a constraint: 1 GiB succeeded in testing, and `wxt.config.ts`
already carries the `'wasm-unsafe-eval'` CSP carve-out.

### The parameters cannot currently be changed

`LockedRepresentation` stores `salt`, `libVersion`, `storageVersion` and nothing
about the KDF, so parameters cannot be varied per vault and cannot be upgraded.
That absence is itself a defect.

Worse, **nothing in the test suite pins them** — see
[06](06-crypto-test-coverage.md). Changing `iterations` today breaks every
existing vault with a fully green `make test`.

## What to do

1. Add `kdf: {algorithm, memorySize, iterations, parallelism, hashLength}` to
   `LockedRepresentation`.
2. Read it when present; default to the current values when absent — that _is_
   the v1 migration.
3. Set new vaults to **m=64 MiB, t=3, p=4** (Bitwarden's default, 259 ms
   measured, 192× the current attacker cost).
4. On a successful v1 unlock, transparently re-wrap at v2 with a fresh salt and
   save.

Cost: a type change, a branch in `generatePasswordHash`, and the re-wrap hook.
Users see one slightly slower unlock, once. No peer-compatibility work — see the
README on why the at-rest format never crosses the wire.

Note `createSyncKey` uses the same parameters but derives from a 256-bit
ECC shared secret, so its cost setting is immaterial. Only
`generatePasswordHash` matters here.

## How to verify

- The fixture test from [06](06-crypto-test-coverage.md) is the real gate: a v1
  vault written before the change must still open after it, on both providers.
- `tests/CryptoProviders/compare-node-browser.test.ts` must stay green.
- Re-measure unlock latency on the extension path; `restoreSession()` runs on
  every MV3 worker boot.

## Resolution

Done 2026-09-16, shipped with [02](02-ciphertext-authenticity.md) as
`storageVersion: 2`. New vaults derive at **m = 64 MiB, t = 3, p = 4,
len = 64** — the target in "What to do", unchanged.

What landed, against the four steps above:

1. **`kdf` on `LockedRepresentation`**, as
   `{algorithm, memorySize, iterations, parallelism, hashLength}`. The values
   themselves live in `src/version.mts` as `V1_KDF_PARAMETERS` and
   `V2_KDF_PARAMETERS`, beside `STORAGE_VERSION`, because they are
   storage-version facts and that module is already the dependency-free leaf
   [03](03-storage-versioning.md) made it. `generatePasswordHash` takes the
   parameters as an argument instead of hardcoding them.
2. **Read when present, v1 assumed when absent** — which is the v1 migration,
   as predicted. The v1 path is deliberately a separate, named `decryptKeysV1`
   rather than a parameter, so that it is greppable and so nothing on the sync
   path can reach it.
3. **New vaults are v2.**
4. **The transparent re-wrap landed**, with one change of shape worth
   recording: the new salt, both re-wrapped keys, the MAC key and the `kdf`
   block are all derived **before** the `FavaLib` is constructed, rather than
   swapped into a live `PersistentStorageManager` afterwards. The salt feeds
   both the at-rest AAD and the envelope MAC, so a half-applied swap would
   produce a vault that saves successfully and never opens again. Building the
   material up front makes that state unrepresentable instead of merely
   avoided. The RSA keypair is **not** rotated — peers hold this device's public
   key, and that is [04](04-key-rotation.md).

`validatePassword` also takes the parameters now. It was the easy caller to
miss: left alone it would derive with v1 parameters, so a correct password
would fail every check after a migration.

`createSyncKey` stays at the v1 parameters, as the closing note above says.

### Measured on this container, after the change

Medians of three, wasm warmed up first:

|                         | measured here | [the table above](#) |
| ----------------------- | ------------- | -------------------- |
| argon2id, v1 parameters | 304 ms        | 134 ms               |
| argon2id, v2 parameters | 538 ms        | 259 ms               |
| **full unlock at v2**   | **502 ms**    | —                    |

This container is roughly 2x slower than whatever produced the table above, so
the absolute numbers are not comparable — but the **ratio** is: v2 costs about
1.8x the v1 wall clock here against 1.9x there. The finding's direction holds.

The full unlock at 502 ms against 538 ms for a single hash is also the check
that **argon2 runs exactly once per unlock**. It used to be easy to get this
wrong in two places: `decryptKeys` deriving the password hash and then the MAC
key derivation deriving it again, and node's `createKeys` running a whole
`decryptKeys` round trip to recover a private key the keygen can hand over
directly ([10](10-rsa-layer.md)). Both are fixed; a regression in either would
put the unlock above 1000 ms.

### The test vectors moved, consciously

[06](06-crypto-test-coverage.md) said whoever landed this must move the policy
assertion and leave the v1 anchor. Done:

- `'v1 parameters produce the known hash'` — **unchanged**, and now explicitly
  marked as surviving until the v1 read path itself goes.
- `'v2 parameters produce the known hash'` — new anchor, same password and salt
  as the v1 vector so the only difference between them is the cost parameters.
  Computed with `hash-wasm` **and** independently reproduced with
  `nixpkgs#libargon2`, which agreed byte for byte; the command line is quoted in
  the file.
- `'the shipped parameters are the v2 parameters'` — the policy assertion,
  moved. It reddens the moment someone edits a parameter, and the file says the
  next person must move it to a v3 vector rather than retune it.
- `'the v1 parameters are still reachable explicitly'` — new, because the
  migration depends on it.

`tests/fixtures/vault-v2.json` is the frozen v2 vault, generated by the code
that shipped this, per the standing convention in `tests/fixtures/README.md`.
The v1 fixture is untouched and must still open — `fixtures.test.mts` asserts
both, plus that a v1 vault re-wraps to v2, reopens, and yields the same OTPs.

Verified by mutation: changing v2 `iterations` from 3 to 2 reddens the v2 policy
assertion and `vault-v2.json`, while both anchors and `vault-v1.json` stay
green.
