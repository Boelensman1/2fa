# 08 — Whole-vault blob vs per-item encryption

**Verdict:** sound
**Status:** closed — no action
**Priority:** —

## Finding

`encryptedVaultState` is a single AES-CBC ciphertext of the whole `VaultState`
(deviceId, the entire entry array, and sync state), where Bitwarden encrypts
each item under the user key separately. The question was what that costs.

The answer is: effectively nothing, for this product.

- **Rewrite cost is irrelevant at this size.** A TOTP vault is tens to low
  hundreds of entries of a few hundred bytes each. Re-encrypting it on every
  write (`performSave`) costs nothing measurable.
- **Partial decryption buys nothing here.** Bitwarden's per-item encryption
  serves partial sync and very large vaults. Neither applies.
- **The granular path already exists where it matters.** Sync encrypts **one
  ephemeral AES key per command per peer** (`SyncManager.mts:872-885`), so
  handing one entry to a less-trusted context never requires handing over the
  whole vault. The design already has per-item granularity on the axis where it
  is actually needed.

The problems that _look_ like they belong to this thread — tampering,
malleability, rollback — are properties of the **missing authenticity**
([02](02-ciphertext-authenticity.md)), not of the blob granularity. Splitting
the blob into per-item ciphertexts without adding an AEAD would fix none of
them, and adding an AEAD fixes them without splitting.

## Decision

Leave as is. Recorded so it does not get re-litigated.

## Resolution

Closed 2026-09-16 — reviewed, no change warranted.
