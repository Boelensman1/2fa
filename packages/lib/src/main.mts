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
} from './interfaces/Entry.mjs'
import type CryptoLib from './interfaces/CryptoLib.mjs'
import type {
  Encrypted,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  EncryptedPublicKey,
  PrivateKey,
  SymmetricKey,
  PublicKey,
  Password,
  Salt,
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
  LockedRepresentationString,
} from './interfaces/Vault.mjs'
import type { SaveFunction } from './interfaces/SaveFunction.mjs'
import type { PlatformProviders } from './interfaces/PlatformProviders.mjs'

import {
  FavaLibError,
  InitializationError,
  AuthenticationError,
  EntryNotFoundError,
  TokenGenerationError,
} from './FavaLibError.mjs'
import { FavaLibEvent } from './FavaLibEvent.mjs'
import { getFavaLibVaultCreationUtils } from './utils/creationUtils.mjs'

export {
  FavaLib,
  FavaLibError,
  getFavaLibVaultCreationUtils,
  InitializationError,
  AuthenticationError,
  EntryNotFoundError,
  TokenGenerationError,
  FavaLibEvent,
}

export type {
  Entry,
  EntryId,
  NewEntry,
  EntryMeta,
  EntryMetaWithToken,
  EntryType,
  TotpPayload,
  Token,
  EncryptedVaultStateString,
  LockedRepresentationString,
  CryptoLib,
  Encrypted,
  EncryptedPrivateKey,
  EncryptedPublicKey,
  EncryptedSymmetricKey,
  PrivateKey,
  SymmetricKey,
  PublicKey,
  Password,
  Salt,
  DeviceId,
  DeviceType,
  DeviceFriendlyName,
  DeviceInfo,
  PublicSyncDevice,
  SaveFunction,
  PlatformProviders,
}
