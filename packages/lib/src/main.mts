import TwoFaLib from './TwoFaLib.mjs'

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
  TwoFALibError,
  InitializationError,
  AuthenticationError,
  EntryNotFoundError,
  TokenGenerationError,
} from './TwoFALibError.mjs'
import { TwoFaLibEvent } from './TwoFaLibEvent.mjs'
import { getTwoFaLibVaultCreationUtils } from './utils/creationUtils.mjs'

export {
  TwoFaLib,
  TwoFALibError,
  getTwoFaLibVaultCreationUtils,
  InitializationError,
  AuthenticationError,
  EntryNotFoundError,
  TokenGenerationError,
  TwoFaLibEvent,
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
