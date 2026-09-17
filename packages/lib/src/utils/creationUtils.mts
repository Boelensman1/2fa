import type { ZxcvbnResult } from '@zxcvbn-ts/core'
import { uint8ArrayToBase64 } from 'uint8array-extras'

import type { PlatformProviders } from '../interfaces/PlatformProviders.mjs'
import type CryptoLib from '../interfaces/CryptoLib.mjs'
import type {
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  MacKey,
  Password,
  PrivateKey,
  PublicKey,
  Salt,
  SymmetricKey,
} from '../interfaces/CryptoLib.mjs'
import type { DeviceId, DeviceType } from '../interfaces/SyncTypes.mjs'

import FavaLib from '../FavaLib.mjs'
import {
  InitializationError,
  FavaLibError,
  StorageVersionError,
  CryptoError,
} from '../FavaLibError.mjs'
import {
  LEGACY_STORAGE_VERSION,
  SESSION_VERSION,
  STORAGE_VERSION,
  V2_KDF_PARAMETERS,
} from '../version.mjs'
import {
  buildEnvelopeMacMessage,
  buildVaultAad,
  type KdfParameters,
} from './canonical.mjs'

import LibraryLoader from '../subclasses/LibraryLoader.mjs'
import type {
  LockedRepresentation,
  LockedRepresentationString,
  UnlockedSession,
  UnlockedSessionString,
  VaultState,
} from '../interfaces/Vault.mjs'
import type { PasswordExtraDict } from '../interfaces/PasswordExtraDict.js'
import { SaveFunction } from '../interfaces/SaveFunction.mjs'
import { validateEntryFatal } from './entryValidation.mjs'
import {
  MAX_SYNC_DEVICES,
  validateSyncDevice,
} from './syncDeviceValidation.mjs'

/** Appended to every message that refuses a vault the user can still recover. */
const DATA_IS_INTACT = 'Do not reset or delete the vault, its data is intact.'

/**
 * Parses JSON, reporting a failure as an InitializationError.
 *
 * A truncated or half-written file is the ordinary way this fails, and the bare
 * SyntaxError that JSON.parse throws is neither a FavaLibError nor a message any
 * consumer can show a user. See key-hierarchy-review/05-load-path-validation.md.
 * @param json - The string to parse.
 * @param what - What is being parsed, used in the error message.
 * @returns The parsed value, as an unknown.
 * @throws {InitializationError} If the string is not valid JSON.
 */
const parseJson = (json: string, what: string): unknown => {
  try {
    return JSON.parse(json)
  } catch {
    throw new InitializationError(`${what} is not valid JSON`)
  }
}

export interface LoadFavaLibOptions {
  /** Whether to connect to the configured sync server while loading. */
  connectToSyncServer?: boolean
}

/**
 * The length of a vault salt, in bytes. 128 bits, matching what createKeys
 * draws in both providers.
 */
const SALT_BYTES = 16

/**
 * Draws a fresh vault salt.
 *
 * Note what a Salt is here: the base64 STRING of the random bytes, and that
 * string is what argon2id receives -- 24 UTF-8 bytes, not the 16 raw ones.
 * See the key-hierarchy-review README, detail 4.
 *
 * Shared by the v1 re-wrap below and by
 * PersistentStorageManager.changePassword, so the two cannot drift: a salt
 * length is a security parameter, and this review has already been bitten once
 * by a constant differing between paths (the 12-vs-16-byte nonce, finding 09).
 * Deliberately not a CryptoLib method -- that interface is public API and a
 * consumer may supply their own provider, so a new required member is a break
 * for them, and there is nothing platform-specific to implement above the
 * getRandomBytes that interface already has.
 * @param cryptoLib - The crypto provider to draw randomness from.
 * @returns A promise resolving to the new salt.
 */
export const generateSalt = async (cryptoLib: CryptoLib): Promise<Salt> =>
  uint8ArrayToBase64(await cryptoLib.getRandomBytes(SALT_BYTES)) as Salt

/**
 * Evaluates the strength of a password.
 * @param libraryLoader - An instance of LibraryLoader.
 * @param passwordExtraDict - Additional words to be used for password strength evaluation.
 * @param password - The password to evaluate.
 * @returns Promise resolving to the password strength result.
 */
export const getPasswordStrength = async (
  libraryLoader: LibraryLoader,
  passwordExtraDict: PasswordExtraDict,
  password: Password,
): Promise<ZxcvbnResult> => {
  const zxcvbn = await libraryLoader.getZxcvbn()
  return zxcvbn(password, [
    'twofactor',
    'authentication',
    'token',
    '2fa',
    'otp',
    'tfa',
    'mfa',
    'security',
    'login',
    'verify',
    'app',
    'yubikey',
    'secret',
    'vault',
    'encrypt',
    'decrypt',
    'qr',
    'timebased',
    'hmac',
    'key',
    'trust',
    'secure',
    ...passwordExtraDict,
  ])
}

/**
 * Validates the strength of a password.
 * @param libraryLoader - An instance of LibraryLoader.
 * @param passwordExtraDict - Additional words to be used for password strength evaluation.
 * @param password - The password to validate.
 * @throws {InitializationError} If the password is too weak.
 */
export const validatePasswordStrength = async (
  libraryLoader: LibraryLoader,
  passwordExtraDict: PasswordExtraDict,
  password: Password,
) => {
  const passwordStrength = await getPasswordStrength(
    libraryLoader,
    passwordExtraDict,
    password,
  )
  if (passwordStrength.score < 3) {
    throw new FavaLibError('Password is too weak')
  }
}

/**
 * Creates a new FavaLib vault.
 * @param libraryLoader - An instance of LibraryLoader.
 * @param deviceType - A unique identifier for the device type e.g. 2fa-cli.
 * @param serverUrl - The server URL for syncing.
 * @param passwordExtraDict - Additional words to be used for password strength evaluation.
 * @param saveFunction - The function to save the data.
 * @param password - The password to be used to encrypt the private key.
 * @returns Promise resolving to an object containing the newly created FavaLib instance and related data.
 */
const createNewFavaLibVault = async (
  libraryLoader: LibraryLoader,
  deviceType: DeviceType,
  serverUrl: string | undefined,
  passwordExtraDict: PasswordExtraDict,
  saveFunction: SaveFunction | undefined,
  password: Password,
) => {
  const cryptoLib = libraryLoader.getCryptoLib()
  const platformProviders = libraryLoader.getPlatformProviders()
  // Before createKeys, not after: createKeys runs a full RSA-4096 keygen plus
  // argon2 at the v2 cost, and rejecting a weak password afterwards spends all
  // of that for nothing. See key-hierarchy-review/10-rsa-layer.md.
  await validatePasswordStrength(libraryLoader, passwordExtraDict, password)

  const {
    publicKey,
    privateKey,
    symmetricKey,
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
    macKey,
    kdf,
  } = await cryptoLib.createKeys(password)

  const deviceId = platformProviders.genUuidV4() as DeviceId
  const favaLib = new FavaLib(
    deviceType,
    platformProviders,
    passwordExtraDict,
    privateKey,
    symmetricKey,
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
    macKey,
    kdf,
    publicKey,
    {
      deviceId,
    },
    [],
    saveFunction,
    {
      serverUrl,
      devices: [],
      commandSendQueue: [],
    },
  )

  return {
    favaLib,
    publicKey,
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
    macKey,
    kdf,
  }
}

/**
 * A LockedRepresentation that has passed the completeness check: the four
 * fields every storage version carries are known to be present and to be
 * strings.
 *
 * `kdf` and `envelopeMac` stay optional on purpose -- a version 1 blob
 * legitimately has neither, and requireV2EnvelopeFields is what says so by
 * name rather than calling a v2 vault "incomplete".
 */
type CompleteLockedRepresentation = Partial<LockedRepresentation> &
  Pick<
    LockedRepresentation,
    | 'encryptedPrivateKey'
    | 'encryptedSymmetricKey'
    | 'salt'
    | 'encryptedVaultState'
  >

/** The two fields a storage version 2 envelope must carry. */
interface V2EnvelopeFields {
  kdf: KdfParameters
  envelopeMac: string
}

/**
 * Every key a constructed FavaLib needs: the four secrets a password unlock
 * derives, and the four stored fields they belong beside.
 *
 * The first four are exactly what an UnlockedSession carries; the last four
 * are read from the LockedRepresentation on both load paths. Keeping them one
 * object is what lets the session path and the password path share everything
 * downstream of the key derivation.
 */
interface UnlockedVaultKeys {
  privateKey: PrivateKey
  publicKey: PublicKey
  symmetricKey: SymmetricKey
  macKey: MacKey
  encryptedPrivateKey: EncryptedPrivateKey
  encryptedSymmetricKey: EncryptedSymmetricKey
  salt: Salt
  kdf: KdfParameters
}

/**
 * Reads and validates the storage version of a parsed stored vault.
 *
 * Takes `unknown` deliberately, and not the Partial<LockedRepresentation> its
 * caller holds: that cast claims the field is a number, which is not true of a
 * hand-crafted or tampered blob. Coercion would then make '2' > 1 true and
 * '0.5' > 1 false, so the cast gives right answers for the wrong reason on
 * some inputs and wrong ones on others.
 *
 * Runs before the completeness check, because a future format will
 * legitimately look "incomplete" to this build -- the user should be told to
 * upgrade, not that their vault is corrupt.
 * @param parsed - The parsed stored vault, of unknown shape.
 * @returns The validated storage version.
 * @throws {StorageVersionError} If the version is not an integer, is out of
 * range, or is newer than this build can read.
 */
const readStorageVersion = (parsed: unknown): number => {
  const rawStorageVersion = (parsed as { storageVersion?: unknown } | undefined)
    ?.storageVersion
  // Absent means a vault written before the field existed. An explicit null is
  // not the same thing -- that is a malformed blob, and falls through to the
  // integer check below.
  const storageVersion =
    rawStorageVersion === undefined ? LEGACY_STORAGE_VERSION : rawStorageVersion
  if (typeof storageVersion !== 'number' || !Number.isInteger(storageVersion)) {
    throw new StorageVersionError(
      `lockedRepresentation has a storageVersion that is not an integer: ${JSON.stringify(storageVersion)}`,
    )
  }
  if (storageVersion < 1) {
    throw new StorageVersionError(
      `lockedRepresentation has an out of range storageVersion: ${storageVersion}`,
    )
  }
  if (storageVersion > STORAGE_VERSION) {
    throw new StorageVersionError(
      `This vault was saved with storage version ${storageVersion}, but this ` +
        `version of the library only supports up to ${STORAGE_VERSION}. ` +
        `Upgrade to a newer version to open it. ` +
        DATA_IS_INTACT,
    )
  }
  return storageVersion
}

/**
 * Checks that a parsed stored vault carries the four fields every storage
 * version has.
 *
 * The typeof half is not redundant with the truthiness half. Every one of
 * these is read through a Partial<LockedRepresentation> cast that claims a
 * type it cannot enforce, so a number or an object would otherwise sail
 * through as a salt and fail much later with something unrecognisable. The
 * truthiness half is what narrows away undefined for the code downstream.
 * @param parsed - The parsed stored vault.
 * @returns The same object, narrowed.
 * @throws {InitializationError} If any of the four is missing or not a string.
 */
const requireCompleteLockedRepresentation = (
  parsed: Partial<LockedRepresentation> | undefined,
): CompleteLockedRepresentation => {
  if (
    !parsed?.encryptedPrivateKey ||
    !parsed.encryptedSymmetricKey ||
    !parsed.salt ||
    !parsed.encryptedVaultState ||
    typeof parsed.encryptedPrivateKey !== 'string' ||
    typeof parsed.encryptedSymmetricKey !== 'string' ||
    typeof parsed.salt !== 'string' ||
    typeof parsed.encryptedVaultState !== 'string'
  ) {
    throw new InitializationError(
      'lockedRepresentation is incomplete or corrupted',
    )
  }
  return parsed as CompleteLockedRepresentation
}

/**
 * Checks that a storage version 2 envelope carries its kdf block and its
 * envelope MAC.
 *
 * Separate from the completeness check above so that the message names the
 * real problem instead of calling a v2 vault "incomplete", and separate from
 * decryptV2VaultState because the password path needs `kdf` before it can call
 * decryptKeys.
 * @param stored - The stored vault, already known to be complete.
 * @param storageVersion - The version it claims, already validated.
 * @returns The two required fields.
 * @throws {InitializationError} If either is missing or of the wrong type.
 */
const requireV2EnvelopeFields = (
  stored: CompleteLockedRepresentation,
  storageVersion: number,
): V2EnvelopeFields => {
  const kdf = stored.kdf
  const envelopeMac = stored.envelopeMac
  if (
    !kdf ||
    !envelopeMac ||
    typeof kdf !== 'object' ||
    typeof envelopeMac !== 'string'
  ) {
    throw new InitializationError(
      `lockedRepresentation claims storage version ${storageVersion} but ` +
        `is missing its kdf parameters or its envelopeMac`,
    )
  }
  return { kdf, envelopeMac }
}

/**
 * Verifies a storage version 2 envelope and decrypts its vault state.
 *
 * The MAC check and the decrypt live in one function so that there is no way
 * to perform one without the other. Both v2 load paths -- password and
 * unlocked session -- go through here, which is a stronger guarantee than a
 * shared tail: a tail can be bypassed by adding a third caller, a chokepoint
 * cannot.
 *
 * The MAC is verified BEFORE anything is decrypted, parsed or used, because
 * this is what authenticates the vault to the holder of the PASSWORD. The
 * AES-GCM tag below proves only that whoever wrote the blob held the data
 * encryption key, and that key arrives wrapped to this device's OWN public
 * key: anyone who has seen that public key can choose their own key, wrap it,
 * re-encrypt an arbitrary vault state, and build a matching AAD out of the
 * cleartext they are writing. See
 * key-hierarchy-review/02-ciphertext-authenticity.md.
 *
 * On the password path it runs AFTER decryptKeys, because a wrong password
 * also produces a wrong MAC key, so checking first would replace the existing
 * 'Invalid password' with an indistinguishable integrity error -- and both the
 * CLI and the browser surface that message to the user.
 *
 * `storageVersion` is passed in rather than read off `stored`, because the
 * value the gate validated is the only one whose type has ever been checked.
 * @param cryptoLib - The crypto provider.
 * @param stored - The stored vault.
 * @param storageVersion - Its validated storage version.
 * @param envelope - Its kdf block and envelope MAC.
 * @param keys - The symmetric key and MAC key to open it with, however they
 * were obtained.
 * @returns A promise resolving to the decrypted vault state json.
 * @throws {CryptoError} If the MAC does not verify, or the ciphertext does not
 * authenticate.
 */
const decryptV2VaultState = async (
  cryptoLib: CryptoLib,
  stored: CompleteLockedRepresentation,
  storageVersion: number,
  envelope: V2EnvelopeFields,
  keys: Pick<UnlockedVaultKeys, 'symmetricKey' | 'macKey'>,
): Promise<string> => {
  const macIsValid = await cryptoLib.verifyEnvelopeMac(
    keys.macKey,
    buildEnvelopeMacMessage({
      libVersion: stored.libVersion ?? '',
      storageVersion,
      salt: stored.salt,
      kdf: envelope.kdf,
      encryptedPrivateKey: stored.encryptedPrivateKey,
      encryptedSymmetricKey: stored.encryptedSymmetricKey,
      encryptedVaultState: stored.encryptedVaultState,
    }),
    envelope.envelopeMac,
  )
  if (!macIsValid) {
    throw new CryptoError(
      'The stored vault failed its integrity check: it has been modified ' +
        'since this device last wrote it. Nothing has been loaded.',
    )
  }

  return await cryptoLib.decryptSymmetric(
    keys.symmetricKey,
    stored.encryptedVaultState,
    buildVaultAad(
      storageVersion,
      stored.salt,
      envelope.kdf,
      await cryptoLib.sha256(stored.encryptedPrivateKey),
    ),
  )
}

/**
 * Parses a decrypted vault state and validates everything inside it.
 *
 * Everything here arrives from inside the blob and has never been checked by
 * anything. Entries went straight into VaultDataManager.replaceVault, whose
 * sanitiseEntry only repairs the three matching fields, and sync.devices was
 * assigned into SyncManager's constructor without even passing through
 * addSyncDevice.
 *
 * This REFUSES rather than dropping, which is the one place this diverges
 * from the tier policy in entryValidation.mts:69-74. Dropping a remote
 * command is lossless because the server redelivers it; dropping an entry
 * here is not, because nothing redelivers a vault -- the entry would be gone
 * from memory and erased from storage by the next ordinary save. A silently
 * vanished TOTP seed is worse than a loud refusal, so the message names what
 * is wrong and says the vault is still intact.
 * See key-hierarchy-review/05-load-path-validation.md.
 *
 * Shared by both load paths on purpose: an unlocked session ingests exactly
 * the same untrusted vault state a password unlock does, so it must be held to
 * the same checks.
 * @param vaultStateString - The decrypted vault state json.
 * @returns The parsed and validated vault state.
 * @throws {InitializationError} If it is not json, is incomplete, or contains
 * an unusable entry or sync device.
 */
const parseVaultState = (vaultStateString: string): VaultState => {
  const vaultState = parseJson(vaultStateString, 'encryptedVaultState') as
    VaultState | undefined

  if (
    !vaultState?.deviceId ||
    !Array.isArray(vaultState.vault) ||
    !Array.isArray(vaultState.sync?.commandSendQueue) ||
    !Array.isArray(vaultState.sync.devices)
  ) {
    throw new InitializationError(
      'encryptedVaultState is incomplete or corrupted',
    )
  }

  for (const entry of vaultState.vault) {
    const reason = validateEntryFatal(entry)
    if (reason) {
      const id = (entry as { id?: unknown } | null)?.id
      throw new InitializationError(
        `The stored vault contains an unusable entry ` +
          `(${typeof id === 'string' ? id : 'no id'}): ${reason}. ` +
          DATA_IS_INTACT,
      )
    }
  }

  if (vaultState.sync.devices.length > MAX_SYNC_DEVICES) {
    throw new InitializationError(
      `The stored vault lists ${vaultState.sync.devices.length} sync devices, ` +
        `more than the ${MAX_SYNC_DEVICES} allowed. ` +
        DATA_IS_INTACT,
    )
  }
  for (const device of vaultState.sync.devices) {
    const reason = validateSyncDevice(device)
    if (reason) {
      const id = (device as { deviceId?: unknown } | null)?.deviceId
      throw new InitializationError(
        `The stored vault contains an unusable sync device ` +
          `(${typeof id === 'string' ? id : 'no deviceId'}): ${reason}. ` +
          DATA_IS_INTACT,
      )
    }
  }

  return vaultState
}

/**
 * Builds the FavaLib instance from a validated vault state and the keys that
 * opened it. Shared by every load path.
 * @param platformProviders - The platform-specific providers.
 * @param deviceType - A unique identifier for this device type.
 * @param passwordExtraDict - Additional words for password strength evaluation.
 * @param saveFunction - The function to save the data.
 * @param keys - The key material the instance runs on.
 * @param vaultState - The decrypted, validated vault state.
 * @param options - Options controlling how the vault is loaded.
 * @returns The constructed instance.
 */
const constructFavaLib = (
  platformProviders: PlatformProviders,
  deviceType: DeviceType,
  passwordExtraDict: PasswordExtraDict,
  saveFunction: SaveFunction | undefined,
  keys: UnlockedVaultKeys,
  vaultState: VaultState,
  options: LoadFavaLibOptions,
): FavaLib =>
  new FavaLib(
    deviceType,
    platformProviders,
    passwordExtraDict,
    keys.privateKey,
    keys.symmetricKey,
    keys.encryptedPrivateKey,
    keys.encryptedSymmetricKey,
    keys.salt,
    keys.macKey,
    keys.kdf,
    keys.publicKey,
    {
      deviceId: vaultState.deviceId,
      deviceFriendlyName: vaultState.deviceFriendlyName,
    },
    vaultState.vault,
    saveFunction,
    vaultState.sync,
    options.connectToSyncServer ?? true,
  )

/**
 * Loads the library state from a previously locked representation.
 * @param libraryLoader - An instance of LibraryLoader.
 * @param deviceType - A unique identifier for this device type (e.g. 2fa-cli).
 * @param passwordExtraDict - Additional words to be used for password strength evaluation.
 * @param saveFunction - The function to save the data.
 * @param lockedRepresentationString - The string representation of the locked library state representation.
 * @param password - The password for decrypting the keys.
 * @param options - Options controlling how the vault is loaded.
 * @returns A promise that resolves when loading is complete.
 * @throws {StorageVersionError} If the vault was saved by a newer library, or its storageVersion is invalid.
 * @throws {InitializationError} If loading fails due to invalid or corrupted data.
 */
const loadFavaLibFromLockedRepesentation = async (
  libraryLoader: LibraryLoader,
  deviceType: DeviceType,
  passwordExtraDict: PasswordExtraDict,
  saveFunction: SaveFunction | undefined,
  lockedRepresentationString: LockedRepresentationString,
  password: Password,
  options: LoadFavaLibOptions = {},
): Promise<FavaLib> => {
  const cryptoLib = libraryLoader.getCryptoLib()
  const platformProviders = libraryLoader.getPlatformProviders()
  const parsed = parseJson(
    lockedRepresentationString,
    'lockedRepresentation',
  ) as Partial<LockedRepresentation> | undefined

  const storageVersion = readStorageVersion(parsed)
  const stored = requireCompleteLockedRepresentation(parsed)

  // Storage version 1 is a MIGRATION PATH, not a supported format. It derives
  // with the v1 argon2id parameters, unwraps with RSA-OAEP/MGF1-SHA-1, reads
  // an unauthenticated AES-256-CBC envelope, and has no envelope MAC to check.
  // This function is the only place in the library allowed to reach any of
  // that; nothing on the sync path may, and neither may the unlocked-session
  // path below. See version.mts on when it goes away.
  const isLegacy = storageVersion < STORAGE_VERSION

  let keys: UnlockedVaultKeys
  let vaultStateString: string

  if (isLegacy) {
    const legacyKeys = await cryptoLib.decryptKeysV1(
      stored.encryptedPrivateKey,
      stored.encryptedSymmetricKey,
      stored.salt,
      password,
    )
    vaultStateString = await cryptoLib.decryptSymmetricV1(
      legacyKeys.symmetricKey,
      stored.encryptedVaultState,
    )

    // The re-wrap, done here rather than after the FavaLib is built, so that
    // the salt, both encrypted keys, the MAC key and the kdf block that reach
    // PersistentStorageManager are consistent BY CONSTRUCTION. The salt feeds
    // both the at-rest AAD and the envelope MAC, so a half-applied swap would
    // produce a vault that saves successfully and never opens again; deriving
    // the new material up front makes that state unrepresentable rather than
    // merely avoided.
    //
    // It is also why an unlocked session cannot open a v1 vault: this step
    // needs the password, and the session path does not have one.
    //
    // The RSA keypair is deliberately NOT rotated: peers hold this device's
    // public key, and rotation is key-hierarchy-review/04-key-rotation.md.
    const salt = await generateSalt(cryptoLib)
    const kdf = V2_KDF_PARAMETERS
    const rewrapped = await cryptoLib.encryptKeys(
      legacyKeys.privateKey,
      legacyKeys.symmetricKey,
      salt,
      password,
      kdf,
    )
    keys = {
      privateKey: legacyKeys.privateKey,
      publicKey: legacyKeys.publicKey,
      symmetricKey: legacyKeys.symmetricKey,
      macKey: rewrapped.macKey,
      encryptedPrivateKey: rewrapped.encryptedPrivateKey,
      encryptedSymmetricKey: rewrapped.encryptedSymmetricKey,
      salt,
      kdf,
    }
  } else {
    const envelope = requireV2EnvelopeFields(stored, storageVersion)

    const decrypted = await cryptoLib.decryptKeys(
      stored.encryptedPrivateKey,
      stored.encryptedSymmetricKey,
      stored.salt,
      password,
      envelope.kdf,
    )
    keys = {
      ...decrypted,
      encryptedPrivateKey: stored.encryptedPrivateKey,
      encryptedSymmetricKey: stored.encryptedSymmetricKey,
      salt: stored.salt,
      kdf: envelope.kdf,
    }

    vaultStateString = await decryptV2VaultState(
      cryptoLib,
      stored,
      storageVersion,
      envelope,
      keys,
    )
  }

  const vaultState = parseVaultState(vaultStateString)

  // The queued commands of a v1 vault are v1-CBC payloads with MGF1-SHA-1 key
  // wraps, and every upgraded peer rejects those. Carrying them across would
  // have a freshly migrated device ship undeliverable traffic on its first
  // connection. They are dropped whether or not this load is able to save,
  // because they are equally undeliverable either way.
  if (isLegacy) {
    vaultState.sync.commandSendQueue = []
  }

  const favaLib = constructFavaLib(
    platformProviders,
    deviceType,
    passwordExtraDict,
    saveFunction,
    keys,
    vaultState,
    options,
  )

  if (isLegacy) {
    // save() is a no-op without a saveFunction, which is exactly the property
    // tests/fixtures.test.mts relies on so that a test run can never rewrite
    // the checked-in v1 fixture.
    await favaLib.storage.forceSave()
    favaLib.reportStorageUpgrade(storageVersion)
  }

  return favaLib
}

/**
 * Parses and validates an exported unlocked session.
 *
 * Every field is checked at runtime. The branded types are compile-time only,
 * and a blob read back out of storage carries no guarantees at all -- the same
 * reason readStorageVersion does not trust its cast.
 * @param unlockedSessionString - The string from exportUnlockedSession.
 * @returns The parsed session.
 * @throws {InitializationError} If it is not json, is a version this build
 * does not write, or is missing any of its four secrets.
 */
const parseUnlockedSession = (
  unlockedSessionString: UnlockedSessionString,
): UnlockedSession => {
  const parsed = parseJson(unlockedSessionString, 'The unlocked session') as
    Partial<UnlockedSession> | undefined

  // Version first, so that a blob this build does not understand is reported
  // as such rather than as a missing field.
  //
  // Compared with !==, not <. An older blob means the process was upgraded
  // under a live session, a newer one means a downgrade, and neither is a
  // shape to guess at. Both cost exactly one password prompt.
  if (parsed?.sessionVersion !== SESSION_VERSION) {
    throw new InitializationError(
      `The unlocked session has version ` +
        `${JSON.stringify(parsed?.sessionVersion)}, but this version of the ` +
        `library only reads version ${SESSION_VERSION}. Unlock with the ` +
        `password instead.`,
    )
  }

  for (const field of [
    'privateKey',
    'publicKey',
    'symmetricKey',
    'macKey',
  ] as const) {
    const value: unknown = parsed[field]
    if (typeof value !== 'string' || !value) {
      throw new InitializationError(
        `The unlocked session is missing its ${field}`,
      )
    }
  }

  return parsed as UnlockedSession
}

/**
 * Loads the library from a stored vault plus an exported unlocked session,
 * without a password.
 *
 * This is the reason the session api exists: an mv3 service worker is evicted
 * after ~30s idle, and replaying a password unlock on every boot means either
 * keeping the master password around or paying argon2id at the v2 cost every
 * half minute. See key-hierarchy-review/07-session-key-api.md.
 *
 * It runs NO key derivation -- no argon2id, no PBES2 unwrap of the private
 * key. The session already holds what those produce; everything else is read
 * from the stored vault, so the two can never disagree about the salt, the kdf
 * block or the encrypted keys.
 *
 * ## What the session is checked against
 *
 * The envelope MAC, exactly as the password path checks it. The MAC key is
 * derived from the password hash, so a session exported before a
 * changePassword carries the pre-rotation key and is refused against the vault
 * that change wrote. There is no epoch counter to keep in sync.
 *
 * That is a binding to a key GENERATION, not freshness. A save moves none of
 * the fields the MAC covers a key for, so one session opens every envelope
 * that generation goes on to write -- and, by the same token, a stale session
 * paired with the stale vault it was exported beside still opens. Rollback is
 * key-hierarchy-review/18-anti-rollback.md and is not addressed here.
 *
 * The vault state it decrypts is validated exactly as the password path
 * validates it (05-load-path-validation.md): same entry and sync-device
 * checks, same refusal.
 *
 * ## For the caller
 *
 * Every throw means the same thing: discard the session and ask for the
 * password. Do not branch on which error it was.
 * @param libraryLoader - An instance of LibraryLoader.
 * @param deviceType - A unique identifier for this device type (e.g. 2fa-cli).
 * @param passwordExtraDict - Additional words to be used for password strength evaluation.
 * @param saveFunction - The function to save the data.
 * @param lockedRepresentationString - The stored vault, as always.
 * @param unlockedSessionString - The string from
 * FavaLib.storage.exportUnlockedSession.
 * @param options - Options controlling how the vault is loaded.
 * @returns A promise resolving to the rehydrated instance.
 * @throws {StorageVersionError} If the vault was saved by a newer library, has
 * an invalid storageVersion, or is a storage version 1 vault.
 * @throws {InitializationError} If either input is invalid or corrupted.
 * @throws {CryptoError} If the session does not fit the stored vault.
 */
const loadFavaLibFromUnlockedSession = async (
  libraryLoader: LibraryLoader,
  deviceType: DeviceType,
  passwordExtraDict: PasswordExtraDict,
  saveFunction: SaveFunction | undefined,
  lockedRepresentationString: LockedRepresentationString,
  unlockedSessionString: UnlockedSessionString,
  options: LoadFavaLibOptions = {},
): Promise<FavaLib> => {
  const cryptoLib = libraryLoader.getCryptoLib()
  const platformProviders = libraryLoader.getPlatformProviders()
  const parsed = parseJson(
    lockedRepresentationString,
    'lockedRepresentation',
  ) as Partial<LockedRepresentation> | undefined

  // The stored vault is gated before the session blob is even parsed, in the
  // same order the password path gates it: a vault from a newer library must
  // be reported as one whatever else is wrong.
  const storageVersion = readStorageVersion(parsed)
  const stored = requireCompleteLockedRepresentation(parsed)

  if (storageVersion < STORAGE_VERSION) {
    // Refused for two independent reasons. A v1 envelope carries no
    // envelopeMac, so there is nothing to check the session against and no way
    // to tell a stale one from a current one. And opening a v1 vault re-wraps
    // it to the current format, which needs the password -- a session does not
    // have one, so this path could not migrate the vault even if it were safe
    // to read it.
    //
    // Keeping it out also preserves the rule decryptKeysV1 and
    // decryptSymmetricV1 document: the legacy crypto has exactly one caller.
    throw new StorageVersionError(
      `An unlocked session cannot open a storage version ${storageVersion} ` +
        `vault: it carries no envelopeMac to check the session against, and ` +
        `upgrading one needs the password. Unlock with the password once; ` +
        `the vault is upgraded in the process.`,
    )
  }

  const session = parseUnlockedSession(unlockedSessionString)
  const envelope = requireV2EnvelopeFields(stored, storageVersion)

  let vaultStateString: string
  try {
    vaultStateString = await decryptV2VaultState(
      cryptoLib,
      stored,
      storageVersion,
      envelope,
      session,
    )
  } catch (error) {
    if (error instanceof CryptoError) {
      // One message for "wrong vault", "exported before a password change" and
      // "the stored vault was tampered with" alike. Telling whoever can write
      // the session store which of their guesses was closest is an oracle, and
      // the library already takes that position one layer down --
      // CryptoLib.decryptSymmetric throws one uniform error for the same
      // reason. The shared message from the password path is also simply wrong
      // here: it blames the stored vault.
      throw new CryptoError(
        'This unlocked session does not fit the stored vault: it was ' +
          'exported before a password change, or it belongs to a different ' +
          'vault. Nothing has been loaded; unlock with the password.',
      )
    }
    throw error
  }

  const vaultState = parseVaultState(vaultStateString)

  return constructFavaLib(
    platformProviders,
    deviceType,
    passwordExtraDict,
    saveFunction,
    {
      ...session,
      encryptedPrivateKey: stored.encryptedPrivateKey,
      encryptedSymmetricKey: stored.encryptedSymmetricKey,
      salt: stored.salt,
      kdf: envelope.kdf,
    },
    vaultState,
    options,
  )
}

/**
 * Returns utility functions useful in creating a new favaLib vault
 * @param platformProviders - The platform-specific providers containing CryptoLib and other providers.
 * @param deviceType - A unique identifier for this device type (e.g. 2fa-cli).
 * @param passwordExtraDict - Additional words to be used for password strength evaluation.
 * @param saveFunction - The function to save the data.
 * @param serverUrl - The server URL for syncing.
 * @returns An object with methods to evaluate password strength and create a new FavaLib vault.
 */
export const getFavaLibVaultCreationUtils = (
  platformProviders: PlatformProviders,
  deviceType: DeviceType,
  passwordExtraDict: PasswordExtraDict,
  saveFunction?: SaveFunction,
  serverUrl?: string,
) => {
  const libraryLoader = new LibraryLoader(platformProviders)

  return {
    getPasswordStrength: getPasswordStrength.bind(
      null,
      libraryLoader,
      passwordExtraDict,
    ),
    createNewFavaLibVault: createNewFavaLibVault.bind(
      null,
      libraryLoader,
      deviceType,
      serverUrl,
      passwordExtraDict,
      saveFunction,
    ),
    loadFavaLibFromLockedRepesentation: loadFavaLibFromLockedRepesentation.bind(
      null,
      libraryLoader,
      deviceType,
      passwordExtraDict,
      saveFunction,
    ),
    loadFavaLibFromUnlockedSession: loadFavaLibFromUnlockedSession.bind(
      null,
      libraryLoader,
      deviceType,
      passwordExtraDict,
      saveFunction,
    ),
  }
}
