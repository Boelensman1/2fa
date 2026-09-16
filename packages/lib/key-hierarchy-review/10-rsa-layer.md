# 10 — Why the RSA layer exists

**Verdict:** sound but incidental — not weak
**Status:** closed — no action
**Priority:** — (two optional cleanups noted below)

## Finding

**Is the keypair load-bearing?** For sync, genuinely yes. Peers wrap per-command
ephemeral AES keys to each other's RSA public keys (`SyncManager.mts:874-877`,
`:997-1000`). The keypair has to exist regardless of the at-rest design.

**For the vault at rest it is incidental.** The symmetric key is wrapped to the
device's _own_ public key — a self-wrap, cryptographically equivalent to
wrapping it directly under `passwordHash`, just with more moving parts. The
routing is historical, not motivated.

**What does routing through it cost?** Less than assumed:

- node-forge RSA-4096 keygen measured a **394 ms median over 6 runs**
  (218–614 ms), and the callback form favalib uses **yields to the event loop**
  — 21 event-loop ticks observed during one keygen. It is not a blocking freeze.
  The repo's own 96–1776 ms figure (`vitest.config.ts`) is for node's native
  path. There is a long tail, and no app shows a spinner, but this is not an
  argument against the design.
- The OAEP failure mode is not a real risk: max plaintext is 470 bytes for
  RSA-4096/OAEP-SHA1 against a 44-byte key.

**Is RSA-OAEP + AES-CBC the right primitive set in 2026?** Split the question:

- Replacing CBC with an AEAD is a **real** fix — that is
  [02](02-ciphertext-authenticity.md), and it is recommended.
- Replacing RSA-4096/OAEP with X25519/HPKE is **"would be nicer", not "is
  weak"**. It is also expensive: peer public keys are already distributed with
  no re-keying story (see [04](04-key-rotation.md) and
  [12](12-out-of-scope-sync-findings.md)). Not recommended now.
- **OAEP uses SHA-1** on both providers — verified empirically: node's
  default-padding `privateDecrypt` accepts a forge `'RSA-OAEP'` ciphertext, and
  forcing `oaepHash: 'sha256'` fails. This is an **audit flag, not a break**:
  OAEP does not need collision resistance, so there is no practical attack. But
  it will fail a compliance review, and cross-provider interop pins it —
  changing it is a cross-device wire break. Revisit only if a compliance
  requirement appears.

## Optional cleanups (not security)

- `node/cryptoLib.mts:80-85` — `createKeys` runs argon2 **twice**: once to set
  the PKCS#8 passphrase, once inside a `decryptKeys` round-trip used only to
  recover the plaintext private key it could have exported directly. ~134 ms
  wasted per vault creation.
- `creationUtils.mts:113` vs `:115` — `createNewFavaLibVault` calls
  `createKeys` **before** `validatePasswordStrength`, so a weak password costs a
  full RSA-4096 keygen before being rejected. Swapping the order is a one-line
  UX win.

## Decision

Keep the RSA layer. Do not restructure the at-rest path around removing it —
that is churn on a published package's stored format for no security gain.

## Resolution

Closed 2026-09-16 — reviewed, no security change warranted. The two cleanups
above are open as ordinary housekeeping, not findings.
