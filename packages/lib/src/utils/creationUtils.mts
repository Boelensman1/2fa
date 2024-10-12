import { v4 as genUuidV4 } from 'uuid'
import type { ZxcvbnResult } from '@zxcvbn-ts/core'
import type { NonEmptyTuple } from 'type-fest'

import type CryptoLib from '../interfaces/CryptoLib.mjs'
import type { Passphrase } from '../interfaces/CryptoLib.mjs'
import type { DeviceId, DeviceType } from '../interfaces/SyncTypes.mjs'

import TwoFaLib from '../TwoFaLib.mjs'
import { InitializationError } from '../TwoFALibError.mjs'

import LibraryLoader from '../subclasses/LibraryLoader.mjs'

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
  passphraseExtraDict: NonEmptyTuple<string>,
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
  passphraseExtraDict: NonEmptyTuple<string>,
) => {
  const passphraseStrength = await getPassphraseStrength(
    libraryLoader,
    passphrase,
    passphraseExtraDict,
  )
  if (passphraseStrength.score < 3) {
    throw new InitializationError('Passphrase is too weak')
  }
}

/**
 * Creates a new TwoFaLib vault.
 * @param libraryLoader - An instance of LibraryLoader.
 * @param deviceType - A unique identifier for the device type e.g. 2fa-cli.
 * @param passphrase - The passphrase to be used to encrypt the private key.
 * @param passphraseExtraDict - Additional words to be used for passphrase strength evaluation.
 * @param serverUrl - The server URL for syncing.
 * @returns Promise resolving to an object containing the newly created TwoFaLib instance and related data.
 */
const createNewTwoFaLibVault = async (
  libraryLoader: LibraryLoader,
  deviceType: DeviceType,
  passphrase: Passphrase,
  passphraseExtraDict: NonEmptyTuple<string>,
  serverUrl?: string,
) => {
  const cryptoLib = libraryLoader.getCryptoLib()
  const { publicKey, encryptedPrivateKey, encryptedSymmetricKey, salt } =
    await cryptoLib.createKeys(passphrase)

  await validatePassphraseStrength(
    libraryLoader,
    passphrase,
    passphraseExtraDict,
  )

  const deviceId = genUuidV4() as DeviceId
  const twoFaLib = new TwoFaLib(deviceType, cryptoLib, passphraseExtraDict)
  await twoFaLib.init(
    encryptedPrivateKey,
    encryptedSymmetricKey,
    salt,
    passphrase,
    deviceId,
    serverUrl,
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
 * Returns utility functions useful in creating a new twoFaLib vault
 * @param cryptoLib - An instance of CryptoLib that is compatible with the environment.
 * @returns An object with methods to evaluate passphrase strength and create a new TwoFaLib vault.
 */
export const getTwoFaLibVaultCreationUtils = (cryptoLib: CryptoLib) => {
  const libraryLoader = new LibraryLoader(cryptoLib)

  return {
    getPassphraseStrength: getPassphraseStrength.bind(null, libraryLoader),
    createNewTwoFaLibVault: createNewTwoFaLibVault.bind(null, libraryLoader),
  }
}
