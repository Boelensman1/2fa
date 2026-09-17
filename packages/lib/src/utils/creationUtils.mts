import type { ZxcvbnResult } from '@zxcvbn-ts/core'
import { uint8ArrayToBase64 } from 'uint8array-extras'

import type { PlatformProviders } from '../interfaces/PlatformProviders.mjs'
import type CryptoLib from '../interfaces/CryptoLib.mjs'
import type {
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
  VaultState,
} from '../interfaces/Vault.mjs'
import type { PasswordExtraDict } from '../interfaces/PasswordExtraDict.js'
import { SaveFunction } from '../interfaces/SaveFunction.mjs'

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

  // Storage version 1 is a MIGRATION PATH, not a supported format. It derives
  // with the v1 argon2id parameters, unwraps with RSA-OAEP/MGF1-SHA-1, reads
  // an unauthenticated AES-256-CBC envelope, and has no envelope MAC to check.
  // This function is the only place in the library allowed to reach any of
  // that; nothing on the sync path may. See version.mts on when it goes away.
  const isLegacy = storageVersion < STORAGE_VERSION

  let privateKey: PrivateKey
  let symmetricKey: SymmetricKey
  let publicKey: PublicKey
  let macKey: MacKey
  let kdf: KdfParameters
  let vaultStateString: string
  let encryptedPrivateKey = lockedRepresentation.encryptedPrivateKey
  let encryptedSymmetricKey = lockedRepresentation.encryptedSymmetricKey
  let salt = lockedRepresentation.salt

  if (isLegacy) {
    const legacyKeys = await cryptoLib.decryptKeysV1(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      password,
    )
    privateKey = legacyKeys.privateKey
    symmetricKey = legacyKeys.symmetricKey
    publicKey = legacyKeys.publicKey
    vaultStateString = await cryptoLib.decryptSymmetricV1(
      symmetricKey,
      lockedRepresentation.encryptedVaultState,
    )

    // The re-wrap, done here rather than after the FavaLib is built, so that
    // the salt, both encrypted keys, the MAC key and the kdf block that reach
    // PersistentStorageManager are consistent BY CONSTRUCTION. The salt feeds
    // both the at-rest AAD and the envelope MAC, so a half-applied swap would
    // produce a vault that saves successfully and never opens again; deriving
    // the new material up front makes that state unrepresentable rather than
    // merely avoided.
    //
    // The RSA keypair is deliberately NOT rotated: peers hold this device's
    // public key, and rotation is key-hierarchy-review/04-key-rotation.md.
    salt = await generateSalt(cryptoLib)
    kdf = V2_KDF_PARAMETERS
    const rewrapped = await cryptoLib.encryptKeys(
      privateKey,
      symmetricKey,
      salt,
      password,
      kdf,
    )
    encryptedPrivateKey = rewrapped.encryptedPrivateKey
    encryptedSymmetricKey = rewrapped.encryptedSymmetricKey
    macKey = rewrapped.macKey
  } else {
    // kdf and envelopeMac are absent from a v1 blob and required from v2.
    // Checked here rather than with the fields above, so that the message
    // names the real problem instead of calling a v2 vault "incomplete".
    const storedKdf = lockedRepresentation.kdf
    const storedEnvelopeMac = lockedRepresentation.envelopeMac
    if (!storedKdf || !storedEnvelopeMac) {
      throw new InitializationError(
        `lockedRepresentation claims storage version ${storageVersion} but ` +
          `is missing its kdf parameters or its envelopeMac`,
      )
    }
    kdf = storedKdf

    const keys = await cryptoLib.decryptKeys(
      encryptedPrivateKey,
      encryptedSymmetricKey,
      salt,
      password,
      kdf,
    )
    privateKey = keys.privateKey
    symmetricKey = keys.symmetricKey
    publicKey = keys.publicKey
    macKey = keys.macKey

    // The envelope MAC is verified AFTER decryptKeys and BEFORE anything is
    // decrypted, parsed or used.
    //
    // After, because a wrong password also produces a wrong MAC key, so
    // checking first would replace the existing 'Invalid password' with an
    // indistinguishable integrity error -- and both the CLI and the browser
    // surface that message to the user.
    //
    // Before anything is used, because this is what authenticates the vault to
    // the holder of the PASSWORD. The AES-GCM tag below proves only that
    // whoever wrote the blob held the data encryption key, and that key
    // arrives wrapped to this device's OWN public key: anyone who has seen
    // that public key can choose their own key, wrap it, re-encrypt an
    // arbitrary vault state, and build a matching AAD out of the cleartext
    // they are writing. See
    // key-hierarchy-review/02-ciphertext-authenticity.md.
    const macIsValid = await cryptoLib.verifyEnvelopeMac(
      macKey,
      buildEnvelopeMacMessage({
        libVersion: lockedRepresentation.libVersion ?? '',
        storageVersion,
        salt,
        kdf,
        encryptedPrivateKey,
        encryptedSymmetricKey,
        encryptedVaultState: lockedRepresentation.encryptedVaultState,
      }),
      storedEnvelopeMac,
    )
    if (!macIsValid) {
      throw new CryptoError(
        'The stored vault failed its integrity check: it has been modified ' +
          'since this device last wrote it. Nothing has been loaded.',
      )
    }

    vaultStateString = await cryptoLib.decryptSymmetric(
      symmetricKey,
      lockedRepresentation.encryptedVaultState,
      buildVaultAad(
        storageVersion,
        salt,
        kdf,
        await cryptoLib.sha256(encryptedPrivateKey),
      ),
    )
  }

  const vaultState = JSON.parse(vaultStateString) as VaultState

  if (
    !vaultState?.deviceId ||
    !vaultState.sync?.commandSendQueue ||
    !vaultState.sync?.devices
  ) {
    throw new InitializationError(
      'encryptedVaultState is incomplete or corrupted',
    )
  }

  // The queued commands of a v1 vault are v1-CBC payloads with MGF1-SHA-1 key
  // wraps, and every upgraded peer rejects those. Carrying them across would
  // have a freshly migrated device ship undeliverable traffic on its first
  // connection. They are dropped whether or not this load is able to save,
  // because they are equally undeliverable either way.
  if (isLegacy) {
    vaultState.sync.commandSendQueue = []
  }

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
      deviceId: vaultState.deviceId,
      deviceFriendlyName: vaultState.deviceFriendlyName,
    },
    vaultState.vault,
    saveFunction,
    vaultState.sync,
    options.connectToSyncServer ?? true,
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
