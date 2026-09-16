# 06 — Nothing pins the KDF parameters or the stored format

**Verdict:** weak — this is what makes every other change dangerous
**Status:** open
**Priority:** P1, but **do it before [01](01-kdf-parameters.md)**
**Touches:** `tests/CryptoProviders/`, `tests/subclasses/PersistentStorageManager.test.mts`

## Finding

**The argon2 parameters are pinned by nothing.** `grep -rn
"argon2\|iterations\|memorySize" packages/lib/tests/` returns zero hits. The
closest thing is `tests/CryptoProviders/compare-node-browser.test.ts:231`,
`'Node and Browser createSyncKey produce the same result'`, which asserts only
that the two providers agree with _each other_ — change `iterations: 256` to `1`
in both files and that test still passes.

There is **no KDF test vector anywhere**, so a parameter change is silently
vault-breaking for every existing user with a fully green suite. This is the
most dangerous single fact in the review.

**The stored format is pinned shallowly.**
`tests/subclasses/PersistentStorageManager.test.mts:96-105` asserts the key set
of the JSON envelope — but `encryptSymmetric` is mocked to the identity function
for that test (lines 74-79), so the actual ciphertext encoding (the
`base64(iv) + ":" + base64(ct)` concatenation) is never asserted.

**There is no checked-in fixture of a real encrypted vault.** Every test builds
its vault fresh in `beforeAll` via `createFavaLibForTests`, so nothing would
catch a format regression against previously-stored data.

## What to do

1. **A KDF test vector**: fixed password + fixed salt + explicit parameters →
   expected hash, asserted against a hardcoded constant. Both providers.
2. **A checked-in v1 fixture vault** (`LockedRepresentation` JSON + its
   password) that must still open. This is the regression gate for
   [01](01-kdf-parameters.md), [02](02-ciphertext-authenticity.md) and
   [03](03-storage-versioning.md) — all three change the stored format.
3. Unmock `encryptSymmetric` in at least one `PersistentStorageManager` test so
   the real ciphertext encoding is asserted.

Two small test files. Cheap, and it converts the format work from "hope" to
"checked".

## How to verify

Deliberately change `iterations` in both providers and confirm the suite now
goes red — first on the test vector, then on the fixture vault.

## Resolution

_Not started._
