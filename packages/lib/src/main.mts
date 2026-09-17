import FavaLib from './FavaLib.mjs'

import type Entry from './interfaces/Entry.mjs'
import type {
  EntryId,
  NewEntry,
  EntryMeta,
  EntryType,
  TotpPayload,
  Token,
  EntryMetaWithToken,
  EntryMetaForUrl,
  EntryMetaForUrlWithToken,
  UrlMatcher,
  UrlMatcherType,
} from './interfaces/Entry.mjs'
import { URL_MATCHER_TYPES } from './interfaces/Entry.mjs'
import {
  MAX_INPUT_SELECTOR_LENGTH,
  MAX_MATCHERS_PER_ENTRY,
  MAX_MATCHER_VALUE_LENGTH,
  MAX_REGEX_SOURCE_LENGTH,
  MAX_URL_LENGTH,
  parseMatcherSpec,
  validateUrlMatcher,
} from './utils/matcherValidation.mjs'
import { suggestMatchersForUrl } from './utils/urlMatching.mjs'
import type CryptoLib from './interfaces/CryptoLib.mjs'
import type {
  Encrypted,
  EncryptedSecretKeys,
  EncryptedSymmetricKey,
  EncryptedPublicKeys,
  DevicePublicKeys,
  DeviceSecretKeys,
  PrivateKey,
  SigningSecretKey,
  SymmetricKey,
  PublicKey,
  SigningPublicKey,
  Signature,
  Password,
  PasswordHash,
  Salt,
  MacKey,
  KdfParameters,
} from './interfaces/CryptoLib.mjs'
import type {
  PublicSyncDevice,
  DeviceId,
  DeviceType,
  DeviceFriendlyName,
  DeviceInfo,
} from './interfaces/SyncTypes.mjs'
import type {
  EncryptedVaultStateString,
  LockedRepresentation,
  LockedRepresentationString,
  UnlockedSession,
  UnlockedSessionString,
} from './interfaces/Vault.mjs'
import type { ServerSecret } from './interfaces/BrandedTypes.mjs'
import type { SaveFunction } from './interfaces/SaveFunction.mjs'
import type { PlatformProviders } from './interfaces/PlatformProviders.mjs'

import {
  FavaLibError,
  InitializationError,
  AuthenticationError,
  CryptoError,
  EntryNotFoundError,
  TokenGenerationError,
  StorageVersionError,
  UnsupportedStorageVersionError,
  SyncPairingVersionError,
} from './FavaLibError.mjs'
import {
  LIB_VERSION,
  SESSION_VERSION,
  STORAGE_VERSION,
  PAIRING_VERSION,
  SYNC_KDF_PARAMETERS,
  V2_KDF_PARAMETERS,
} from './version.mjs'
import { FavaLibEvent } from './FavaLibEvent.mjs'
import {
  getFavaLibVaultCreationUtils,
  type LoadFavaLibOptions,
} from './utils/creationUtils.mjs'

export {
  FavaLib,
  FavaLibError,
  getFavaLibVaultCreationUtils,
  InitializationError,
  AuthenticationError,
  CryptoError,
  EntryNotFoundError,
  TokenGenerationError,
  StorageVersionError,
  UnsupportedStorageVersionError,
  SyncPairingVersionError,
  LIB_VERSION,
  SESSION_VERSION,
  STORAGE_VERSION,
  PAIRING_VERSION,
  SYNC_KDF_PARAMETERS,
  V2_KDF_PARAMETERS,
  FavaLibEvent,
  URL_MATCHER_TYPES,
  validateUrlMatcher,
  parseMatcherSpec,
  suggestMatchersForUrl,
  MAX_MATCHERS_PER_ENTRY,
  MAX_MATCHER_VALUE_LENGTH,
  MAX_REGEX_SOURCE_LENGTH,
  MAX_URL_LENGTH,
  MAX_INPUT_SELECTOR_LENGTH,
}

export type {
  Entry,
  EntryId,
  NewEntry,
  EntryMeta,
  EntryMetaWithToken,
  EntryMetaForUrl,
  EntryMetaForUrlWithToken,
  UrlMatcher,
  UrlMatcherType,
  EntryType,
  TotpPayload,
  Token,
  EncryptedVaultStateString,
  LockedRepresentation,
  LockedRepresentationString,
  UnlockedSession,
  UnlockedSessionString,
  CryptoLib,
  Encrypted,
  EncryptedSecretKeys,
  EncryptedPublicKeys,
  EncryptedSymmetricKey,
  DevicePublicKeys,
  DeviceSecretKeys,
  PrivateKey,
  SigningSecretKey,
  SymmetricKey,
  PublicKey,
  SigningPublicKey,
  Signature,
  Password,
  PasswordHash,
  Salt,
  MacKey,
  KdfParameters,
  DeviceId,
  DeviceType,
  DeviceFriendlyName,
  DeviceInfo,
  PublicSyncDevice,
  ServerSecret,
  SaveFunction,
  PlatformProviders,
  LoadFavaLibOptions,
}
