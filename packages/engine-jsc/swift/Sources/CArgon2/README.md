# CArgon2

The Argon2 reference implementation, vendored unmodified from
[P-H-C/phc-winner-argon2](https://github.com/P-H-C/phc-winner-argon2) release
20190702 (CC0 1.0 or Apache 2.0, see LICENSE).

Only what `argon2id_hash_raw` needs, and only the portable `ref.c` core:
`opt.c` is SSE (x86) and iOS devices are ARM. Multi-lane hashing runs on
pthreads (`thread.c`), which is what makes the vault's parallelism of 4 cost
about a quarter of the single-threaded time.

Why not libsodium: its `crypto_pwhash` argon2id is fixed at parallelism 1, and
fava vaults use 4. The output has to match hash-wasm's byte for byte, which this
does (checked against the vault parameters in `Tests/FavaEngineTests`).
