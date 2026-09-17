# 10 — Why the RSA layer exists

**Verdict:** sound but incidental — not weak; **the Decision below was later
reversed**, see the amendment at the end
**Status:** closed — superseded by the curve migration in
[13](13-sync-command-authentication.md)
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
  [12](12-sync-findings-index.md)). Not recommended now.
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

Closed 2026-09-16 — reviewed, no security change warranted. **Amended the same
day** when [02](02-ciphertext-authenticity.md) shipped: the Decision stands, but
two costs of the at-rest self-wrap that this review did not weigh came out of
that work and belong here, next to the benefits.

### Amendment: two costs of the at-rest self-wrap

1. **The self-wrap makes the vault ciphertext forgeable by anyone holding the
   device's public key.** The data encryption key is RSA-OAEP wrapped under the
   device's _own_ public key, so an AES-GCM tag over the vault state proves only
   that the writer held that key — and anyone with the public key can mint one,
   wrap it, re-encrypt an arbitrary vault state and build a matching AAD from
   the cleartext fields they are writing. "Cryptographically equivalent to
   wrapping it directly under `passwordHash`, just with more moving parts" is
   true of confidentiality and **false of integrity**: wrapping under
   `passwordHash` would not have had this property.

   This is why v2 carries a separate `envelopeMac` keyed from the password hash.
   A separate MAC rather than mixing the password hash into the content key,
   precisely to keep the re-wrap-to-another-public-key affordance that is the
   reason this finding kept the RSA layer — a future recovery flow re-issues the
   MAC. See `02`'s Resolution, and the named regression test in
   `tests/envelope-integrity.test.mts`.

2. **`encryptedPrivateKey` exists at all only because of the self-wrap, and it
   is still AES-256-CBC.** Routing the DEK through an RSA private key means that
   private key must itself be stored encrypted, which is the PBES2 blob — and
   `decryptKeys` still distinguishes `ERR_OSSL_BAD_DECRYPT` from
   `ERR_OSSL_UNSUPPORTED` (forge: `'Invalid password'` vs `'Unsupported private
key'`). So "AES-GCM everywhere" is not true of the at-rest path and the
   README hierarchy does not claim it. Not urgent — it is PBES2, and there is no
   adaptive oracle against a local file — but it is a cost of this design, not
   an incidental detail.

Neither changes the Decision. Both are the honest other half of it.

### The cleanups

`02` took all three of the items in this file that were actionable:

- **OAEP MGF1 SHA-1 → SHA-256**, on both providers. Deferred here only because
  it is a cross-device wire break, which `02`'s clean break already paid for.
  The v1 read path keeps SHA-1. One correction to the note above: node-forge
  **defaults `mgf1` to `md`** (`pkcs1.js`, `if(!mgf1Md) { mgf1Md = md }`), so
  passing `md` alone would have matched node rather than silently diverging. The
  real hazard is an _explicit_ mismatch, which round-trips inside forge and
  fails only against node; `compare-node-browser.test.ts` asserts that case
  specifically.
- **node's `createKeys` double argon2** — gone. The keypair is now generated as
  an unencrypted PKCS#8 PEM and the encrypted form derived from it, so there is
  one argon2 call instead of two. Worth far more at the v2 parameters than the
  ~134 ms quoted above.
- **`validatePasswordStrength` before `createKeys`** — done, one line.

Not taken: dropping the at-rest self-wrap. The Decision above stands.

## Amendment: the Decision was reversed, and by an argument this file did not consider

The Decision above — keep the RSA layer, including the at-rest self-wrap — stood
on a question this file asked well: _is the keypair load-bearing?_ The answer
was yes, for sync, so the layer stayed.

[13](13-sync-command-authentication.md) asked a different one: _what can the
keypair prove?_ RSA-OAEP is an encryption primitive. It says nothing about who
encrypted, and the library had no signing path at all, so "a signed command from
a trusted device" was not expressible. The choice was between adding RSA
signatures to a hierarchy this file already called incidental, or replacing the
asymmetric layer. It was replaced, on 2026-09-17: X25519 for the key agreement
this file correctly identified as load-bearing, Ed25519 for the signatures it
had no reason to think about.

Both costs recorded in the amendment above are gone with it:

- the `encryptedPrivateKey` PBES2/AES-256-CBC blob is gone, because nothing
  routes a DEK through a private key any more — both at-rest seals are AES-GCM
  under keys derived from the password hash;
- the self-wrap is gone, so the ciphertext forgery that made
  [02](02-ciphertext-authenticity.md)'s `envelopeMac` necessary has no entry
  point left. The MAC stays, for the cleartext fields.

Two observations in this file survive the reversal, and are worth keeping:

- **The re-wrap-to-another-public-key affordance** the Decision valued is not
  lost. It was never about RSA: a recovery flow re-seals the symmetric key to
  another key and re-issues the MAC, exactly as described, with X25519 in place
  of RSA-OAEP.
- **The OAEP MGF1 hazard** this file and `02` spent real effort pinning is not
  merely fixed but structurally gone. It existed because the two providers
  implemented the same primitive twice — node-forge and OpenSSL — and agreed
  only while every padding parameter matched. The curve layer is one
  implementation (`@noble/curves`) used by both providers, with no parameters to
  match.

What remains RSA-shaped is the v1 read path, and only that: `decryptKeysV1` and
the PBES2 unwrap beside it. Deleting it (item 1 of
[18](18-anti-rollback.md)) removes RSA from the library entirely.

**Amended 2026-09-17: done.** The v1 read path was deleted rather than kept
until installs upgraded, and with it `node-forge` left the dependency tree.
There is no RSA in favalib.
