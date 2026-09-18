/**
 * Canonical encoding for the values that are authenticated but not encrypted:
 * the additional authenticated data (AAD) handed to AES-256-GCM, and the
 * message covered by the envelope MAC.
 *
 * This module deliberately imports nothing but the branded types. It has to be
 * callable from `creationUtils`, `PersistentStorageManager` and `SyncManager`
 * alike, and two of those already sit on a runtime import cycle.
 *
 * ## Why every field is length-prefixed
 *
 * An AAD is only as good as the injection-resistance of its encoding. The
 * at-rest string happens to be safe on its own -- a base64 salt, some integers
 * and a hex digest contain no separator -- but the sync contexts are not:
 *
 * - `commandId` is a uuidv4 only by default (Command/BaseCommand.mts), and on
 *   the receive path it is taken straight from the server payload as a bare
 *   `commandId: string` (SyncManager.receiveCommands, ClientMessage.mts).
 * - `fromDeviceId` is stamped by the server (server.mts).
 * - `DeviceId` is a `Tagged<string>` (interfaces/BrandedTypes.mts): a
 *   compile-time brand with no runtime validation whatsoever.
 *
 * Those are exactly the adversary-influenced strings an AAD is meant to defend
 * against. Length-prefixing makes the encoding unambiguous regardless of what a
 * field contains, and removes the need for a per-field alphabet argument that a
 * later field addition could quietly invalidate.
 *
 * `buildCommandSignatureMessage` below uses the same encoder, and needs it
 * more: an AAD only has to be unambiguous to the one key that can open the
 * ciphertext, a signature to every device holding the signer's public key.
 */

const textEncoder = new TextEncoder()

/**
 * Encodes a list of fields so that no field's content can be confused for the
 * boundary between two fields.
 *
 * Every field, the domain separator included, is emitted as
 * `<utf-8 byte length>:<value>`. Concatenation of those is injective: the
 * length tells the reader exactly how many bytes to consume, so no choice of
 * field content can produce the same encoding as a different field list.
 * @param fields - The fields to encode, in a fixed order. The first is the
 * domain separator.
 * @returns The canonical encoding.
 */
export const encodeFields = (fields: readonly (string | number)[]): string =>
  fields
    .map((field) => {
      const value = typeof field === 'number' ? String(field) : field
      return `${textEncoder.encode(value).length}:${value}`
    })
    .join('')

/**
 * The argon2id cost parameters a vault was written with. Stored in the
 * LockedRepresentation from storage version 2 onwards so that the parameters
 * can be raised again later without breaking existing vaults.
 */
export interface KdfParameters {
  algorithm: 'argon2id'
  memorySize: number
  iterations: number
  parallelism: number
  hashLength: number
}

/**
 * Builds the AAD for the vault state stored at rest.
 *
 * Note there is no `v2` literal in the domain separator: `storageVersion` is
 * already a field, and any reshaping of this encoding is itself a
 * storage-format break, so the two would always have to move together. One
 * encoding of one number.
 *
 * `encryptedSecretKeysDigest` binds the ciphertext to the exact sealed key
 * material it was written beside. It was added to close the password-change
 * splice at a time when `changePassword` re-wrapped only the private key,
 * reusing both the salt and the symmetric key: without it the AAD and the data
 * encryption key were identical before and after a change, so an
 * `encryptedVaultState` lifted from a pre-change backup authenticated under the
 * new password.
 *
 * `changePassword` now rotates the salt and the symmetric key too, closing that
 * splice twice over. The field stays: it stops a blob assembled from two
 * generations authenticating, whatever moved between them.
 *
 * It does NOT close rollback under an unchanged password, where the sealed keys
 * are unchanged too, nor envelope forgery, since a forger writes the AAD
 * themselves -- that is the envelope MAC's job.
 * @param storageVersion - The storage version of the envelope.
 * @param salt - The vault salt.
 * @param kdf - The argon2id parameters the vault was written with.
 * @param encryptedSecretKeysDigest - base64 SHA-256 of the EXACT STORED BYTES
 * of `encryptedSecretKeys`. Never of a re-serialised form: the value is what
 * was written, not what a reconstruction of it would look like.
 * @returns The canonical AAD string.
 */
export const buildVaultAad = (
  storageVersion: number,
  salt: string,
  kdf: KdfParameters,
  encryptedSecretKeysDigest: string,
): string =>
  encodeFields([
    'favalib:vault',
    storageVersion,
    salt,
    kdf.algorithm,
    kdf.memorySize,
    kdf.iterations,
    kdf.parallelism,
    kdf.hashLength,
    encryptedSecretKeysDigest,
  ])

/**
 * Builds the AAD for one of the two at-rest key seals.
 *
 * Storage version 2 wraps the device's secret keys and the vault's symmetric
 * key under two keys derived from the password hash, replacing the RSA
 * self-wrap and the PBES2 blob that preceded them. The purpose separates the
 * two seals, and the salt and kdf bind each to the parameter set its wrapping
 * key was derived under -- so a seal cannot be lifted from a vault written
 * before a password change (which rotates both) into one written after.
 * @param purpose - Which seal this is.
 * @param salt - The vault salt.
 * @param kdf - The argon2id parameters the wrapping key was derived with.
 * @returns The canonical AAD string.
 */
export const buildKeyWrapAad = (
  purpose: 'secret-keys' | 'symmetric-key',
  salt: string,
  kdf: KdfParameters,
): string =>
  encodeFields([
    'favalib:keywrap:v2',
    purpose,
    salt,
    kdf.algorithm,
    kdf.memorySize,
    kdf.iterations,
    kdf.parallelism,
    kdf.hashLength,
  ])

/**
 * Builds the AAD for a single encrypted sync command.
 * @param commandId - The command id, as it travels in the cleartext envelope.
 * @param deviceId - The device the command is addressed to.
 * @returns The canonical AAD string.
 */
export const buildCommandAad = (commandId: string, deviceId: string): string =>
  encodeFields(['favalib:command:v2', commandId, deviceId])

/**
 * Builds the message a sending device signs over a sync command.
 *
 * Four fields, and each one is load-bearing:
 *
 * - `payload` is the exact JSON string that gets encrypted, signed verbatim
 *   rather than re-serialised from a parsed object. Signing a re-serialisation
 *   would make the signature's meaning depend on key order and number
 *   formatting agreeing between two builds, which is the kind of thing that
 *   holds until someone upgrades one device.
 * - `commandId` binds the signature to the envelope the server delivers it in,
 *   so a stored blob cannot be re-announced under a different id.
 * - `fromDeviceId` names the signer. The recipient looks that device up in its
 *   own peer list and verifies with the key IT holds, so the name is a lookup
 *   key and not a claim -- and a device removed from the list stops being able
 *   to say anything at all.
 * - `toDeviceId` stops a command sealed to one peer being replayed at another.
 * @param commandId - The command id, as it travels in the cleartext envelope.
 * @param fromDeviceId - The device that signed the command.
 * @param toDeviceId - The device the command is addressed to.
 * @param payload - The exact serialised command that is encrypted.
 * @returns The canonical message to sign.
 */
export const buildCommandSignatureMessage = (
  commandId: string,
  fromDeviceId: string,
  toDeviceId: string,
  payload: string,
): string =>
  encodeFields([
    'favalib:commandsig:v2',
    commandId,
    fromDeviceId,
    toDeviceId,
    payload,
  ])

/**
 * Builds the message a sending device signs over a full vault state.
 *
 * The initial vault of an add-device flow and a resilver are the two messages
 * that carry the whole vault, and were as unauthenticated as commands were:
 * sealing to a public key proves nothing about who sealed. Same defect, same
 * path, same fix.
 * @param fromDeviceId - The device sending the vault state.
 * @param forDeviceId - The device it is addressed to.
 * @param encryptedVaultData - The sealed vault state, signed as it travels.
 * @returns The canonical message to sign.
 */
export const buildVaultDataSignatureMessage = (
  fromDeviceId: string,
  forDeviceId: string,
  encryptedVaultData: string,
): string =>
  encodeFields([
    'favalib:vaultdatasig:v2',
    fromDeviceId,
    forDeviceId,
    encryptedVaultData,
  ])

/**
 * Builds the message a device's key fingerprint is taken over.
 *
 * Both public keys, and the device id that claims them. The two differ in
 * length, but nothing about their CONTENTS distinguishes the sealing key from
 * the signing one -- only their position in this message does, which is why
 * they go through `encodeFields` like everything else here rather than being
 * concatenated. Length-prefixing also means the two can grow independently
 * without the encoding becoming ambiguous.
 *
 * Including `deviceId` binds the fingerprint to the identity the keys are
 * listed under, so a record that swaps in a different id does not keep the
 * fingerprint a user already checked.
 * @param deviceId - The device the keys belong to.
 * @param publicKey - Its composite key agreement public key.
 * @param signingPublicKey - Its composite signing public key.
 * @returns The canonical message to digest.
 */
export const buildDeviceFingerprintMessage = (
  deviceId: string,
  publicKey: string,
  signingPublicKey: string,
): string =>
  encodeFields(['favalib:devicefp:v2', deviceId, publicKey, signingPublicKey])

/**
 * Builds the AAD for a full vault state sent to a peer, both for the initial
 * vault of an add-device flow and for a resilver.
 * @param fromDeviceId - The device sending the vault state.
 * @param forDeviceId - The device it is addressed to.
 * @returns The canonical AAD string.
 */
export const buildVaultDataAad = (
  fromDeviceId: string,
  forDeviceId: string,
): string => encodeFields(['favalib:vaultdata:v2', fromDeviceId, forDeviceId])

/**
 * Builds the AAD for the public key and device info exchanged under the JPAKE
 * sync key during an add-device flow.
 * @param initiatorDeviceId - The device that started the flow.
 * @param responderDeviceId - The device joining the vault.
 * @returns The canonical AAD string.
 */
export const buildHandshakeAad = (
  initiatorDeviceId: string,
  responderDeviceId: string,
): string =>
  encodeFields(['favalib:handshake:v2', initiatorDeviceId, responderDeviceId])

/**
 * The fields of a LockedRepresentation covered by the envelope MAC: every one
 * of them except `envelopeMac` itself.
 *
 * "Everything but the MAC" is deliberately the rule, rather than a chosen
 * subset. It avoids a per-field argument about what is worth covering, and
 * `libVersion` is recomputed on every save anyway, so including it costs
 * nothing.
 */
export interface EnvelopeMacFields {
  libVersion: string
  storageVersion: number
  salt: string
  kdf: KdfParameters
  encryptedSecretKeys: string
  encryptedSymmetricKey: string
  encryptedVaultState: string
}

/**
 * Builds the message covered by the envelope MAC.
 *
 * The MAC is what authenticates the vault to the holder of the PASSWORD. It was
 * added because the AES-GCM tag could not: the data encryption key used to
 * arrive via an RSA-OAEP wrap under the device's own public key, so anyone
 * holding that public key could choose their own key, wrap it, encrypt an
 * arbitrary vault state under it and build a matching AAD from the cleartext
 * fields they were writing.
 *
 * The self-wrap is gone -- both at-rest seals are under keys derived from the
 * password hash -- so forging a readable vault needs the password now. The MAC
 * still earns its place: it covers `libVersion`, `storageVersion`, `salt` and
 * `kdf`, which no ciphertext authenticates, and it is what makes a truncated or
 * field-swapped envelope fail with "this vault has been modified" rather than
 * as a decryption error.
 * @param fields - Every LockedRepresentation field except `envelopeMac`.
 * @returns The canonical MAC message.
 */
export const buildEnvelopeMacMessage = (fields: EnvelopeMacFields): string =>
  encodeFields([
    'favalib:envelope:v2',
    fields.libVersion,
    fields.storageVersion,
    fields.salt,
    fields.kdf.algorithm,
    fields.kdf.memorySize,
    fields.kdf.iterations,
    fields.kdf.parallelism,
    fields.kdf.hashLength,
    fields.encryptedSecretKeys,
    fields.encryptedSymmetricKey,
    fields.encryptedVaultState,
  ])

/**
 * Builds the message the initiator's pairing KEM public key is digested over.
 *
 * The pairing payload is small on purpose -- it has to survive being a QR code
 * on a phone screen -- and an ML-KEM-768 public key is 1184 bytes. So the key
 * itself is relayed through the untrusted sync server and only this 32-byte
 * digest travels out of band, where it does the same job: a relayed key that
 * does not digest to it is not the one the initiator meant to send.
 *
 * `initiatorDeviceId` is in the message so a digest cannot be lifted from one
 * initiator's payload and reused to vouch for the same key under another
 * identity. The key is passed base64 rather than raw, because that is the exact
 * form the wire carries and the responder checks; digesting a re-decoded form
 * would be digesting a reconstruction.
 * @param initiatorDeviceId - The device that generated the key.
 * @param kemPublicKey - The base64 ML-KEM public key, exactly as it travels.
 * @returns The canonical message to digest.
 */
export const buildPairingKemDigestMessage = (
  initiatorDeviceId: string,
  kemPublicKey: string,
): string =>
  encodeFields(['favalib:pairingkem:v2', initiatorDeviceId, kemPublicKey])

/**
 * Builds the transcript the two pairing key shares are combined under.
 *
 * The sync key comes from two exchanges, not one: J-PAKE over the out-of-band
 * password, and an ML-KEM encapsulation to the key the digest above vouches
 * for. Either one holding is enough to keep the key secret, which is the whole
 * point -- J-PAKE is a discrete-log problem and a recorded pairing would
 * otherwise be decryptable in retrospect, and ML-KEM is young enough that
 * leaning on it alone would be its own bet.
 *
 * `kemCipherText` is in the transcript for the reason the seal's transcript
 * carries one: a KEM shared secret does not by itself commit to the ciphertext
 * it came from. Without it a tampered ciphertext could be swapped in and both
 * sides would simply derive different keys, which is a confusing failure; with
 * it the derivation is pinned to the exact exchange that happened.
 * @param responderDeviceId - The device joining the vault.
 * @param kemCipherText - The base64 ML-KEM ciphertext, exactly as it travels.
 * @returns The canonical transcript.
 */
export const buildPairingCombineMessage = (
  responderDeviceId: string,
  kemCipherText: string,
): string =>
  encodeFields(['favalib:pairingcombine:v2', responderDeviceId, kemCipherText])

/**
 * Builds the message a client HMACs to prove it holds the sync server's shared
 * secret.
 *
 * One field, and the omissions are the design. There is no `deviceId`: every
 * device of a deployment holds the secret, so an HMAC under it proves
 * membership and nothing about who computed it. Binding an id would make the
 * proof LOOK like device authentication while staying a statement anyone with
 * the secret can make about any id.
 *
 * Freshness is the nonce's whole job: the server draws it per socket and
 * accepts it once, so a captured proof is worth nothing on the next connection.
 * That is also why the secret itself never travels -- a plain `ws://` link in
 * development would otherwise hand it to anyone watching.
 *
 * `v1` rather than `v2`: the other separators here take their version from the
 * storage format they belong to, and this one belongs to no stored format at
 * all. It is the first version of a wire handshake, and it moves when that
 * handshake does.
 * @param nonce - The server's per-socket challenge, base64 of 32 random bytes.
 * @returns The canonical message to HMAC.
 */
export const buildConnectAuthMessage = (nonce: string): string =>
  encodeFields(['favalib:connectauth:v1', nonce])
