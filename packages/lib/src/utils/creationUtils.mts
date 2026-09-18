import type { PasswordStrength } from '../interfaces/PasswordStrength.mjs'
import { uint8ArrayToBase64 } from 'uint8array-extras'

import type { PlatformProviders } from '../interfaces/PlatformProviders.mjs'
import type CryptoLib from '../interfaces/CryptoLib.mjs'
import type {
  EncryptedSecretKeys,
  EncryptedSymmetricKey,
  MacKey,
  Password,
  PrivateKey,
  PublicKey,
  Salt,
  SigningPublicKey,
  SigningSecretKey,
  SymmetricKey,
} from '../interfaces/CryptoLib.mjs'
import type { DeviceId, DeviceType } from '../interfaces/SyncTypes.mjs'

import FavaLib from '../FavaLib.mjs'
import {
  InitializationError,
  FavaLibError,
  StorageVersionError,
  UnsupportedStorageVersionError,
  CryptoError,
} from '../FavaLibError.mjs'
import { SESSION_VERSION, STORAGE_VERSION } from '../version.mjs'
import {
  buildEnvelopeMacMessage,
  buildVaultAad,
  type KdfParameters,
} from './canonical.mjs'

import LibraryLoader from '../subclasses/LibraryLoader.mjs'
import type {
  LockedRepresentation,
  LockedRepresentationString,
  ProcessedCommand,
  UnlockedSession,
  UnlockedSessionString,
  VaultState,
  VaultSyncStateWithServerUrl,
} from '../interfaces/Vault.mjs'
import type { PasswordExtraDict } from '../interfaces/PasswordExtraDict.js'
import { SaveFunction } from '../interfaces/SaveFunction.mjs'
import { validateEntryFatal } from './entryValidation.mjs'
import {
  MAX_SYNC_DEVICES,
  validateRemovedDevices,
  validateSyncDevice,
} from './syncDeviceValidation.mjs'
import {
  encryptionPublicKeyFromSecret,
  signingPublicKeyFromSecret,
} from '../platformProviders/shared/asymmetric.mjs'

/** Appended to every message that refuses a vault the user can still recover. */
const DATA_IS_INTACT = 'Do not reset or delete the vault, its data is intact.'

/**
 * The way across from a storage version this build no longer reads.
 *
 * There is deliberately no automatic upgrade. The entries export is a list of
 * otpauth:// URIs and carries no storage version at all, so it crosses the
 * break unchanged -- which an in-place migration could not do, since the old
 * format's RSA keypair cannot become a curve one and every peer would have to
 * pair again regardless.
 */
const MIGRATE_BY_EXPORTING =
  'Open it with the version of the app that wrote it, export your entries, ' +
  'and import them here.'

/**
 * Parses JSON, reporting a failure as an InitializationError.
 *
 * A truncated or half-written file is the ordinary way this fails, and the bare
 * SyntaxError JSON.parse throws is neither a FavaLibError nor a message any
 * consumer can show a user.
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
  /**
   * Overrides the stored connection settings before any socket opens, keeping
   * paired devices and pending commands. Included in subsequent vault saves.
   */
  syncServer?: Pick<VaultSyncStateWithServerUrl, 'serverUrl' | 'serverSecret'>
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
 *
 * Shared with PersistentStorageManager.changePassword so the two cannot drift:
 * a salt length is a security parameter, and a constant differing between paths
 * has bitten this code before (the 12-vs-16-byte nonce).
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
): Promise<PasswordStrength> => {
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
 *
 * A new vault is created with sync SWITCHED OFF, and there is no parameter for
 * a server here on purpose. Configuring sync means supplying a url and the
 * server's shared secret together -- neither is usable without the other, see
 * `setSyncServerUrl` -- so creation cannot half-configure it, and the state
 * "has a server url, cannot authenticate to it" has nowhere to come from.
 * @param libraryLoader - An instance of LibraryLoader.
 * @param deviceType - A unique identifier for the device type e.g. 2fa-cli.
 * @param passwordExtraDict - Additional words to be used for password strength evaluation.
 * @param saveFunction - The function to save the data.
 * @param password - The password to be used to encrypt the private key.
 * @returns Promise resolving to an object containing the newly created FavaLib instance and related data.
 */
const createNewFavaLibVault = async (
  libraryLoader: LibraryLoader,
  deviceType: DeviceType,
  passwordExtraDict: PasswordExtraDict,
  saveFunction: SaveFunction | undefined,
  password: Password,
) => {
  const cryptoLib = libraryLoader.getCryptoLib()
  const platformProviders = libraryLoader.getPlatformProviders()
  // Before createKeys, not after: createKeys runs argon2 at the v2 cost, and
  // rejecting a weak password afterwards spends all of that for nothing. Curve
  // keygen is cheap now, but argon2 still is not.
  await validatePasswordStrength(libraryLoader, passwordExtraDict, password)

  const {
    publicKey,
    signingPublicKey,
    privateKey,
    signingSecretKey,
    symmetricKey,
    encryptedSecretKeys,
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
    { privateKey, signingSecretKey },
    symmetricKey,
    encryptedSecretKeys,
    encryptedSymmetricKey,
    salt,
    macKey,
    kdf,
    { publicKey, signingPublicKey },
    {
      deviceId,
    },
    [],
    saveFunction,
    {
      serverUrl: undefined,
      devices: [],
      commandSendQueue: [],
    },
  )

  return {
    favaLib,
    publicKey,
    signingPublicKey,
    encryptedSecretKeys,
    encryptedSymmetricKey,
    salt,
    macKey,
    kdf,
  }
}

/**
 * A LockedRepresentation whose every required field is known to be present and
 * of the right type.
 *
 * `libVersion` stays optional: it is informational, recorded so a consumer can
 * tell which build last wrote a vault, and it must never decide whether one
 * opens.
 */
type CompleteLockedRepresentation = Partial<
  Pick<LockedRepresentation, 'libVersion'>
> &
  Omit<LockedRepresentation, 'libVersion' | 'storageVersion'>

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
  signingSecretKey: SigningSecretKey
  publicKey: PublicKey
  signingPublicKey: SigningPublicKey
  symmetricKey: SymmetricKey
  macKey: MacKey
  encryptedSecretKeys: EncryptedSecretKeys
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
 * Runs before the completeness check, because a format this build does not
 * read will legitimately look "incomplete" to it -- the user should be told
 * which version they have, not that their vault is corrupt.
 *
 * There is exactly one readable version. Anything older is refused rather than
 * migrated: a v1 blob needed no matching salt or kdf block to be accepted over
 * a current vault, so reading the old format at all was a downgrade window
 * wider than plain rollback.
 * @param parsed - The parsed stored vault, of unknown shape.
 * @returns The validated storage version.
 * @throws {StorageVersionError} If the version is not an integer, is out of
 * range, or is newer than this build can read.
 * @throws {UnsupportedStorageVersionError} If it is older than this build
 * reads.
 */
const readStorageVersion = (parsed: unknown): number => {
  const storageVersion = (parsed as { storageVersion?: unknown } | undefined)
    ?.storageVersion
  // An absent field is not defaulted. It means a vault written before the
  // field existed, which is storage version 1, and that is refused below like
  // any other version this build does not read. An explicit null is a
  // malformed blob and falls through to the integer check.
  if (storageVersion === undefined) {
    throw new UnsupportedStorageVersionError(
      `This vault carries no storageVersion, so it was saved in a format ` +
        `older than the one this version reads (${STORAGE_VERSION}). ` +
        MIGRATE_BY_EXPORTING +
        ' ' +
        DATA_IS_INTACT,
    )
  }
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
  if (storageVersion < STORAGE_VERSION) {
    throw new UnsupportedStorageVersionError(
      `This vault was saved with storage version ${storageVersion}, and this ` +
        `version reads only ${STORAGE_VERSION}. There is no automatic ` +
        `upgrade. ` +
        MIGRATE_BY_EXPORTING +
        ' ' +
        DATA_IS_INTACT,
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
 * Checks that a parsed stored vault carries every field it needs.
 *
 * The typeof half is not redundant with the truthiness half. Every one of
 * these is read through a Partial<LockedRepresentation> cast that claims a
 * type it cannot enforce, so a number or an object would otherwise sail
 * through as a salt and fail much later with something unrecognisable. The
 * truthiness half is what narrows away undefined for the code downstream.
 *
 * One check rather than three: while there were two storage formats, the key
 * slot was named differently in each and the kdf block and envelope MAC were
 * absent from one of them, so requiring them here would have called a
 * perfectly good vault "incomplete". With a single format there is nothing
 * left to be conditional about.
 * @param parsed - The parsed stored vault.
 * @returns The same object, narrowed.
 * @throws {InitializationError} If any field is missing or of the wrong type.
 */
const requireCompleteLockedRepresentation = (
  parsed: Partial<LockedRepresentation> | undefined,
): CompleteLockedRepresentation => {
  if (
    !parsed?.encryptedSecretKeys ||
    !parsed.encryptedSymmetricKey ||
    !parsed.salt ||
    !parsed.encryptedVaultState ||
    !parsed.kdf ||
    !parsed.envelopeMac ||
    typeof parsed.encryptedSecretKeys !== 'string' ||
    typeof parsed.encryptedSymmetricKey !== 'string' ||
    typeof parsed.salt !== 'string' ||
    typeof parsed.encryptedVaultState !== 'string' ||
    typeof parsed.kdf !== 'object' ||
    typeof parsed.envelopeMac !== 'string'
  ) {
    throw new InitializationError(
      'lockedRepresentation is incomplete or corrupted',
    )
  }
  return parsed as CompleteLockedRepresentation
}

/**
 * Verifies a stored vault's envelope and decrypts its vault state.
 *
 * The MAC check and the decrypt live in one function so that there is no way
 * to perform one without the other. Both load paths -- password and unlocked
 * session -- go through here, which is a stronger guarantee than a shared
 * tail: a tail can be bypassed by adding a third caller, a chokepoint
 * cannot.
 *
 * The MAC is verified BEFORE anything is decrypted, parsed or used, because
 * this is what authenticates the vault to the holder of the PASSWORD. The
 * AES-GCM tag below proves only that whoever wrote the blob held the data
 * encryption key, and that key used to arrive wrapped to this device's OWN
 * public key: anyone who had seen it could choose their own key, wrap it,
 * re-encrypt an arbitrary vault state, and build a matching AAD from the
 * cleartext they were writing.
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
 * @param keys - The symmetric key and MAC key to open it with, however they
 * were obtained.
 * @returns A promise resolving to the decrypted vault state json.
 * @throws {CryptoError} If the MAC does not verify, or the ciphertext does not
 * authenticate.
 */
const decryptVaultState = async (
  cryptoLib: CryptoLib,
  stored: CompleteLockedRepresentation,
  storageVersion: number,
  keys: Pick<UnlockedVaultKeys, 'symmetricKey' | 'macKey'>,
): Promise<string> => {
  const macIsValid = await cryptoLib.verifyEnvelopeMac(
    keys.macKey,
    buildEnvelopeMacMessage({
      libVersion: stored.libVersion ?? '',
      storageVersion,
      salt: stored.salt,
      kdf: stored.kdf,
      encryptedSecretKeys: stored.encryptedSecretKeys,
      encryptedSymmetricKey: stored.encryptedSymmetricKey,
      encryptedVaultState: stored.encryptedVaultState,
    }),
    stored.envelopeMac,
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
      stored.kdf,
      await cryptoLib.sha256(stored.encryptedSecretKeys),
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
 * This REFUSES rather than dropping, the one place it diverges from the tier
 * policy in entryValidation.mts:69-74. A dropped remote command is redelivered
 * by the server; a dropped entry is not, and would be erased from storage by
 * the next ordinary save. A silently vanished TOTP seed is worse than a loud
 * refusal, so the message names what is wrong and says the vault is still
 * intact.
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

  // Absent is fine and means "this device has applied nothing yet", true of
  // every vault written before the record existed. Present but malformed is
  // REFUSED rather than reset: silently starting replay protection over is the
  // one repair whose cost is invisible, since the vault works perfectly
  // afterwards and simply accepts commands it had already applied.
  const processedCommands = vaultState.sync.processedCommands
  if (
    processedCommands !== undefined &&
    (typeof processedCommands !== 'object' ||
      !Array.isArray(processedCommands.commands) ||
      typeof processedCommands.floors !== 'object' ||
      processedCommands.floors === null ||
      !processedCommands.commands.every(
        (entry) =>
          typeof (entry as Partial<ProcessedCommand>)?.id === 'string' &&
          typeof (entry as Partial<ProcessedCommand>).from === 'string' &&
          typeof (entry as Partial<ProcessedCommand>).timestamp === 'number',
      ) ||
      !Object.values(processedCommands.floors).every(
        (floor) => typeof floor === 'number',
      ))
  ) {
    throw new InitializationError(
      `The stored vault's replay-protection record is unusable. ` +
        DATA_IS_INTACT,
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

  // Refused rather than reset, the same call this file makes for the replay
  // record above and for the same reason: a vault that has quietly forgotten
  // what it revoked works perfectly and accepts a device the user removed.
  const removedDevicesReason = validateRemovedDevices(
    vaultState.sync.removedDevices,
  )
  if (removedDevicesReason) {
    throw new InitializationError(
      `The stored vault's record of removed devices is unusable ` +
        `(${removedDevicesReason}). ` +
        DATA_IS_INTACT,
    )
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

  // A device that is both listed and tombstoned is a contradiction this vault
  // cannot have written: SyncManager.removeSyncDevice splices and tombstones
  // together, and addSyncDevice refuses a tombstoned id. So it is either a
  // vault edited outside the library or a bug, and the refusal is the same
  // either way -- resolving it in favour of the device list would discard a
  // revocation, which is the one repair whose cost is invisible.
  const removedDevices = vaultState.sync.removedDevices ?? {}
  for (const device of vaultState.sync.devices) {
    if (device.deviceId in removedDevices) {
      throw new InitializationError(
        `The stored vault lists sync device ${device.deviceId} and also ` +
          `records it as removed. ` +
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
    { privateKey: keys.privateKey, signingSecretKey: keys.signingSecretKey },
    keys.symmetricKey,
    keys.encryptedSecretKeys,
    keys.encryptedSymmetricKey,
    keys.salt,
    keys.macKey,
    keys.kdf,
    { publicKey: keys.publicKey, signingPublicKey: keys.signingPublicKey },
    {
      deviceId: vaultState.deviceId,
      deviceFriendlyName: vaultState.deviceFriendlyName,
    },
    vaultState.vault,
    saveFunction,
    { ...vaultState.sync, ...options.syncServer },
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
 * @throws {UnsupportedStorageVersionError} If the vault was saved in a storage
 * version older than the one this build reads. There is no migration.
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

  const decrypted = await cryptoLib.decryptKeys(
    stored.encryptedSecretKeys,
    stored.encryptedSymmetricKey,
    stored.salt,
    password,
    stored.kdf,
  )
  const keys: UnlockedVaultKeys = {
    ...decrypted,
    encryptedSecretKeys: stored.encryptedSecretKeys,
    encryptedSymmetricKey: stored.encryptedSymmetricKey,
    salt: stored.salt,
    kdf: stored.kdf,
  }

  const vaultStateString = await decryptVaultState(
    cryptoLib,
    stored,
    storageVersion,
    keys,
  )

  const vaultState = parseVaultState(vaultStateString)

  return constructFavaLib(
    platformProviders,
    deviceType,
    passwordExtraDict,
    saveFunction,
    keys,
    vaultState,
    options,
  )
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
    'signingSecretKey',
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
 * after ~30s idle, so replaying a password unlock on every boot means either
 * keeping the master password around or paying argon2id at the v2 cost every
 * half minute.
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
 * paired with the stale vault it was exported beside still opens. Rollback is a
 * separate problem, not addressed here.
 *
 * The vault state it decrypts is validated exactly as the password path
 * validates it: same entry and sync-device checks, same refusal.
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
  // same order the password path gates it: a vault this build cannot read must
  // be reported as one whatever else is wrong.
  const storageVersion = readStorageVersion(parsed)
  const stored = requireCompleteLockedRepresentation(parsed)

  const session = parseUnlockedSession(unlockedSessionString)

  let vaultStateString: string
  try {
    vaultStateString = await decryptVaultState(
      cryptoLib,
      stored,
      storageVersion,
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
      // Both public keys are derived from the secret keys rather than carried
      // in the session blob, for the same reason the blob carries no salt: a
      // stored copy is one more value that can disagree with the key material
      // it claims to describe.
      publicKey: encryptionPublicKeyFromSecret(session.privateKey),
      signingPublicKey: signingPublicKeyFromSecret(session.signingSecretKey),
      encryptedSecretKeys: stored.encryptedSecretKeys,
      encryptedSymmetricKey: stored.encryptedSymmetricKey,
      salt: stored.salt,
      kdf: stored.kdf,
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
 * @returns An object with methods to evaluate password strength and create a new FavaLib vault.
 */
export const getFavaLibVaultCreationUtils = (
  platformProviders: PlatformProviders,
  deviceType: DeviceType,
  passwordExtraDict: PasswordExtraDict,
  saveFunction?: SaveFunction,
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
