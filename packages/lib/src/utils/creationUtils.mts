import type { ZxcvbnResult } from '@zxcvbn-ts/core'

import type { PlatformProviders } from '../interfaces/PlatformProviders.mjs'
import type { Password } from '../interfaces/CryptoLib.mjs'
import type { DeviceId, DeviceType } from '../interfaces/SyncTypes.mjs'

import FavaLib from '../FavaLib.mjs'
import { InitializationError, FavaLibError } from '../FavaLibError.mjs'

import LibraryLoader from '../subclasses/LibraryLoader.mjs'
import type {
  LockedRepresentation,
  LockedRepresentationString,
  VaultState,
} from '../interfaces/Vault.mjs'
import type { PasswordExtraDict } from '../interfaces/PasswordExtraDict.js'
import { SaveFunction } from '../interfaces/SaveFunction.mjs'

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
 * @returns A promise that resolves when loading is complete.
 * @throws {InitializationError} If loading fails due to invalid or corrupted data.
 */
const loadFavaLibFromLockedRepesentation = async (
  libraryLoader: LibraryLoader,
  deviceType: DeviceType,
  passwordExtraDict: PasswordExtraDict,
  saveFunction: SaveFunction | undefined,
  lockedRepresentationString: LockedRepresentationString,
  password: Password,
): Promise<FavaLib> => {
  const cryptoLib = libraryLoader.getCryptoLib()
  const platformProviders = libraryLoader.getPlatformProviders()
  const lockedRepresentation = JSON.parse(lockedRepresentationString) as
    | Partial<LockedRepresentation>
    | undefined

  if (
    !lockedRepresentation ||
    !lockedRepresentation.encryptedPrivateKey ||
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
    !vaultState ||
    !vaultState.deviceId ||
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
