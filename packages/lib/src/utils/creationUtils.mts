import { v4 as genUuidV4 } from 'uuid'
import type { ZxcvbnResult } from '@zxcvbn-ts/core'

import type CryptoLib from '../interfaces/CryptoLib.mjs'
import type { Passphrase } from '../interfaces/CryptoLib.mjs'
import type { DeviceId, DeviceType } from '../interfaces/SyncTypes.mjs'

import TwoFaLib from '../TwoFaLib.mjs'
import { InitializationError, TwoFALibError } from '../TwoFALibError.mjs'

import LibraryLoader from '../subclasses/LibraryLoader.mjs'
import type {
  LockedRepresentation,
  LockedRepresentationString,
  VaultState,
} from '../interfaces/Vault.mjs'
import type { PassphraseExtraDict } from '../interfaces/PassphraseExtraDict.js'

/**
 * Evaluates the strength of a passphrase.
 * @param libraryLoader - An instance of LibraryLoader.
 * @param passphrase - The passphrase to evaluate.
 * @param passphraseExtraDict - Additional words to be used for passphrase strength evaluation.
 * @returns Promise resolving to the passphrase strength result.
 */
export const getPassphraseStrength = async (
  libraryLoader: LibraryLoader,
  passphrase: Passphrase,
  passphraseExtraDict: PassphraseExtraDict,
): Promise<ZxcvbnResult> => {
  const zxcvbn = await libraryLoader.getZxcvbn()
  return zxcvbn(passphrase, [
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
    ...passphraseExtraDict,
  ])
}

/**
 * Validates the strength of a passphrase.
 * @param libraryLoader - An instance of LibraryLoader.
 * @param passphrase - The passphrase to validate.
 * @param passphraseExtraDict - Additional words to be used for passphrase strength evaluation.
 * @throws {InitializationError} If the passphrase is too weak.
 */
export const validatePassphraseStrength = async (
  libraryLoader: LibraryLoader,
  passphrase: Passphrase,
  passphraseExtraDict: PassphraseExtraDict,
) => {
  const passphraseStrength = await getPassphraseStrength(
    libraryLoader,
    passphrase,
    passphraseExtraDict,
  )
  if (passphraseStrength.score < 3) {
    throw new TwoFALibError('Passphrase is too weak')
  }
}

/**
 * Creates a new TwoFaLib vault.
 * @param libraryLoader - An instance of LibraryLoader.
 * @param deviceType - A unique identifier for the device type e.g. 2fa-cli.
 * @param serverUrl - The server URL for syncing.
 * @param passphraseExtraDict - Additional words to be used for passphrase strength evaluation.
 * @param passphrase - The passphrase to be used to encrypt the private key.
 * @returns Promise resolving to an object containing the newly created TwoFaLib instance and related data.
 */
const createNewTwoFaLibVault = async (
  libraryLoader: LibraryLoader,
  deviceType: DeviceType,
  serverUrl: string | undefined,
  passphraseExtraDict: PassphraseExtraDict,
  passphrase: Passphrase,
) => {
  const cryptoLib = libraryLoader.getCryptoLib()
  const {
    publicKey,
    privateKey,
    symmetricKey,
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
  } = await cryptoLib.createKeys(passphrase)

  await validatePassphraseStrength(
    libraryLoader,
    passphrase,
    passphraseExtraDict,
  )

  const deviceId = genUuidV4() as DeviceId
  const twoFaLib = new TwoFaLib(
    deviceType,
    cryptoLib,
    passphraseExtraDict,
    privateKey,
    symmetricKey,
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
    publicKey,
    deviceId,
    [],
    serverUrl,
    [],
  )

  return {
    twoFaLib,
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
 * @param serverUrl - The server URL for syncing.
 * @param passphraseExtraDict - Additional words to be used for passphrase strength evaluation.
 * @param lockedRepresentationString - The string representation of the locked library state representation.
 * @param passphrase - The passphrase for decrypting the keys.
 * @returns A promise that resolves when loading is complete.
 * @throws {InitializationError} If loading fails due to invalid or corrupted data.
 */
const loadTwoFaLibFromLockedRepesentation = async (
  libraryLoader: LibraryLoader,
  deviceType: DeviceType,
  serverUrl: string | undefined,
  passphraseExtraDict: PassphraseExtraDict,
  lockedRepresentationString: LockedRepresentationString,
  passphrase: Passphrase,
): Promise<TwoFaLib> => {
  const cryptoLib = libraryLoader.getCryptoLib()
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
    passphrase,
  )

  const vaultState = JSON.parse(
    await cryptoLib.decryptSymmetric(
      symmetricKey,
      lockedRepresentation.encryptedVaultState,
    ),
  ) as VaultState

  if (!vaultState || !vaultState.deviceId || !vaultState.syncDevices) {
    throw new InitializationError(
      'encryptedVaultState is incomplete or corrupted',
    )
  }

  return new TwoFaLib(
    deviceType,
    cryptoLib,
    passphraseExtraDict,
    privateKey,
    symmetricKey,
    lockedRepresentation.encryptedPrivateKey,
    lockedRepresentation.encryptedSymmetricKey,
    lockedRepresentation.salt,
    publicKey,
    vaultState.deviceId,
    vaultState.vault,
    serverUrl,
    vaultState.syncDevices,
  )
}

/**
 * Returns utility functions useful in creating a new twoFaLib vault
 * @param cryptoLib - An instance of CryptoLib that is compatible with the environment.
 * @param deviceType - A unique identifier for this device type (e.g. 2fa-cli).
 * @param passphraseExtraDict - Additional words to be used for passphrase strength evaluation.
 * @param serverUrl - The server URL for syncing.
 * @returns An object with methods to evaluate passphrase strength and create a new TwoFaLib vault.
 */
export const getTwoFaLibVaultCreationUtils = (
  cryptoLib: CryptoLib,
  deviceType: DeviceType,
  passphraseExtraDict: PassphraseExtraDict,
  serverUrl?: string,
) => {
  const libraryLoader = new LibraryLoader(cryptoLib)

  return {
    getPassphraseStrength: getPassphraseStrength.bind(null, libraryLoader),
    createNewTwoFaLibVault: createNewTwoFaLibVault.bind(
      null,
      libraryLoader,
      deviceType,
      serverUrl,
      passphraseExtraDict,
    ),
    loadTwoFaLibFromLockedRepesentation:
      loadTwoFaLibFromLockedRepesentation.bind(
        null,
        libraryLoader,
        deviceType,
        serverUrl,
        passphraseExtraDict,
      ),
  }
}
