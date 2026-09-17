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
 * against, and nothing authenticates the sender yet (see
 * key-hierarchy-review/13-sync-command-authentication.md). Length-prefixing
 * makes the encoding unambiguous regardless of what a field contains, and
 * removes the need for a per-field alphabet argument that a later field
 * addition could quietly invalidate.
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
const encodeFields = (fields: readonly (string | number)[]): string =>
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
 * `encryptedPrivateKeyDigest` binds the ciphertext to the exact wrapped private
 * key it was written beside. It was added to close the password-change splice
 * at a time when `changePassword` re-wrapped only the private key, reusing both
 * the salt and the symmetric key: without it the AAD and the data encryption
 * key were identical before and after a change, so an `encryptedVaultState`
 * lifted from a pre-change backup authenticated under the new password.
 *
 * `changePassword` now rotates the salt and the symmetric key too
 * (key-hierarchy-review/04-key-rotation.md), so that splice is closed twice
 * over. The field stays: it is part of the v2 envelope and removing it would be
 * a storage-format break, and it is what keeps a blob assembled from two
 * generations from authenticating at the ciphertext layer, whatever moved
 * between them.
 *
 * It does NOT close rollback under an unchanged password, where the encrypted
 * private key is unchanged too (that is
 * key-hierarchy-review/18-anti-rollback.md), and it does not touch envelope
 * forgery, since a forger writes the AAD themselves -- that is what the
 * envelope MAC is for.
 * @param storageVersion - The storage version of the envelope.
 * @param salt - The vault salt.
 * @param kdf - The argon2id parameters the vault was written with.
 * @param encryptedPrivateKeyDigest - base64 SHA-256 of the EXACT STORED BYTES
 * of `encryptedPrivateKey`. Never of a re-serialised or line-ending-normalised
 * form: node exports PEM with "\n" and node-forge with "\r\n", so normalising
 * on one path and not the other gives spurious authentication failures, and
 * the cross-provider case is where they surface first.
 * @returns The canonical AAD string.
 */
export const buildVaultAad = (
  storageVersion: number,
  salt: string,
  kdf: KdfParameters,
  encryptedPrivateKeyDigest: string,
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
    encryptedPrivateKeyDigest,
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
  encryptedPrivateKey: string
  encryptedSymmetricKey: string
  encryptedVaultState: string
}

/**
 * Builds the message covered by the envelope MAC.
 *
 * The MAC is what authenticates the vault to the holder of the PASSWORD. The
 * AES-GCM tag cannot: the data encryption key arrives via an RSA-OAEP wrap
 * under the device's own public key, so anyone holding that public key can
 * choose their own key, wrap it, encrypt an arbitrary vault state under it and
 * build a matching AAD from the cleartext fields they are writing. See
 * key-hierarchy-review/02-ciphertext-authenticity.md.
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
    fields.encryptedPrivateKey,
    fields.encryptedSymmetricKey,
    fields.encryptedVaultState,
  ])
