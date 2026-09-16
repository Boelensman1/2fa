import type { ZxcvbnResult } from '@zxcvbn-ts/core'

import type { PlatformProviders } from '../interfaces/PlatformProviders.mjs'
import type { Password } from '../interfaces/CryptoLib.mjs'
import type { DeviceId, DeviceType } from '../interfaces/SyncTypes.mjs'

import FavaLib from '../FavaLib.mjs'
import {
  InitializationError,
  FavaLibError,
  StorageVersionError,
} from '../FavaLibError.mjs'
import { LEGACY_STORAGE_VERSION, STORAGE_VERSION } from '../version.mjs'

import LibraryLoader from '../subclasses/LibraryLoader.mjs'
import type {
  LockedRepresentation,
  LockedRepresentationString,
  VaultState,
} from '../interfaces/Vault.mjs'
import type { PasswordExtraDict } from '../interfaces/PasswordExtraDict.js'
import { SaveFunction } from '../interfaces/SaveFunction.mjs'

export interface LoadFavaLibOptions {
  /** Whether to connect to the configured sync server while loading. */
  connectToSyncServer?: boolean
}

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
  const {
    publicKey,
    privateKey,
    symmetricKey,
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
  } = await cryptoLib.createKeys(password)

  await validatePasswordStrength(libraryLoader, passwordExtraDict, password)

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
  }
}

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
  const lockedRepresentation = JSON.parse(lockedRepresentationString) as
    Partial<LockedRepresentation> | undefined

  // Read the version before anything else, and deliberately not through the
  // Partial<LockedRepresentation> cast above: that cast claims the field is a
  // number, which is not true of a hand-crafted or tampered blob. Coercion
  // would then make '2' > 1 true and '0.5' > 1 false, so the cast gives right
  // answers for the wrong reason on some inputs and wrong ones on others.
  //
  // This also runs before the completeness check below, because a future
  // format will legitimately look "incomplete" to this build -- the user
  // should be told to upgrade, not that their vault is corrupt.
  const rawStorageVersion = (
    lockedRepresentation as { storageVersion?: unknown } | undefined
  )?.storageVersion
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
        `Upgrade to a newer version to open it. Do not reset or delete the ` +
        `vault, its data is intact.`,
    )
  }

  if (
    !lockedRepresentation?.encryptedPrivateKey ||
    !lockedRepresentation.encryptedSymmetricKey ||
    !lockedRepresentation.salt ||
    !lockedRepresentation.encryptedVaultState
  ) {
    throw new InitializationError(
      'lockedRepresentation is incomplete or corrupted',
    )
  }

  const { privateKey, symmetricKey, publicKey } = await cryptoLib.decryptKeys(
    lockedRepresentation.encryptedPrivateKey,
    lockedRepresentation.encryptedSymmetricKey,
    lockedRepresentation.salt,
    password,
  )

  const vaultState = JSON.parse(
    await cryptoLib.decryptSymmetric(
      symmetricKey,
      lockedRepresentation.encryptedVaultState,
    ),
  ) as VaultState

  if (
    !vaultState?.deviceId ||
    !vaultState.sync?.commandSendQueue ||
    !vaultState.sync?.devices
  ) {
    throw new InitializationError(
      'encryptedVaultState is incomplete or corrupted',
    )
  }

  return new FavaLib(
    deviceType,
    platformProviders,
    passwordExtraDict,
    privateKey,
    symmetricKey,
    lockedRepresentation.encryptedPrivateKey,
    lockedRepresentation.encryptedSymmetricKey,
    lockedRepresentation.salt,
    publicKey,
    {
      deviceId: vaultState.deviceId,
      deviceFriendlyName: vaultState.deviceFriendlyName,
    },
    vaultState.vault,
    saveFunction,
    vaultState.sync,
    options.connectToSyncServer ?? true,
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
  }
}
