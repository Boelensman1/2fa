# 11 — Threat model

Reference, not an action item. What each layer does and does not defend against.

## Defended

- **Blob at rest, attacker has no password.** Confidentiality holds. The chain
  is sound in shape; only the KDF cost is under-set
  ([01](01-kdf-parameters.md)).
- **Malicious or compromised sync server reading vault contents.** Holds.
  Everything relayed is encrypted to keys the server never sees. JPAKE pairing
  uses a 60-byte CSPRNG secret (`SyncManager.mts:489-491`), so the pairing
  channel is not offline-attackable.
- **Forged vault state redirecting the sync server.** Holds — `serverUrl` is
  ignored on import and `setSyncServerUrl` enforces `wss://`.

## Not defended

- **Offline grind of a stolen `LockedRepresentation` — the threat that matters
  most here.** The only barrier is argon2id at 134 ms/guess with no effective
  memory hardness: ~11× below OWASP's floor and ~192× below Bitwarden's default
  on an area-time basis. The zxcvbn score-3 gate is doing real work and is the
  main reason this is "weak" rather than "broken".

  Note the CLI weakens its own model: `keytar` stores the **password** on the
  same machine as `vault.json`
  (`app-cli/src/commands/vault/create.mts:58`), so a live-session attacker skips
  the grind entirely. The blob also exists in three places on disk —
  `vault.json`, `vault.json.tmp` transiently, and `vault.json.backup`
  permanently.

- **Tampering with the stored blob.** Undefended — no authenticity at all
  ([02](02-ciphertext-authenticity.md)). Rollback via `vault.json.backup` needs
  no cryptanalysis.

- **Hostile content in a decrypted vault state.** Undefended — entries from disk
  and from peers bypass the validators that already exist
  ([05](05-load-path-validation.md)).

- **Post-compromise recovery.** Undefended — no rotation, and `changePassword`
  revokes nothing ([04](04-key-rotation.md)).

- **Sync-layer forgery and replay.** Undefended — see
  [12](12-sync-findings-index.md).

## Assumptions this model rests on

- GPU/ASIC argon2 throughput at a 512 KiB working set was **not measured**; the
  multipliers are the area-time model.
- Real password entropy behind the zxcvbn score-3 gate is assumed to be around
  10¹⁰ guesses for a decent password.
- `browser.storage.session` is assumed not to resist a compromised browser
  process.
