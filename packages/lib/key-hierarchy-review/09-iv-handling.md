# 09 — IV handling

**Verdict:** sound
**Status:** closed — no action
**Priority:** —

## Finding

Checked for the usual failure modes: fixed IVs, derived IVs, counter reuse,
IV-as-key confusion. None present.

Both providers generate a fresh 16-byte IV from a CSPRNG on **every**
encryption, never derive or reuse it, and prepend it to the ciphertext:

- node — `randomBytes(16)` (`src/platformProviders/node/cryptoLib.mts:221`)
- browser — `crypto.getRandomValues(new Uint8Array(16))`
  (`src/platformProviders/browser/cryptoLib.mts:179`)

Wire format is `base64(iv) + ":" + base64(ct)`. The `split(':')` on the decrypt
side is safe because the base64 alphabet contains no `:`.

This is correct for CBC.

## Decision

Leave as is. Note that [02](02-ciphertext-authenticity.md) replaces CBC with an
AEAD, which changes the nonce discipline — GCM nonces must be 12 bytes and must
never repeat under the same key. The current per-encryption-CSPRNG habit carries
over correctly, but do not reuse the 16-byte IV code path verbatim.

## Resolution

Closed 2026-09-16 — reviewed, no change warranted. Revisit the nonce rule when
[02](02-ciphertext-authenticity.md) lands.
