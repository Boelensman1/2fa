# 01 — Argon2id parameters

**Verdict:** weak — the sharpest issue in the key hierarchy
**Status:** open
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

_Not started._
