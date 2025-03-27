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
  Passphrase,
  Salt,
} from './interfaces/CryptoLib.mjs'
import type {
  PublicSyncDevice,
  DeviceId,
  DeviceType,
  DeviceFriendlyName,
} from './interfaces/SyncTypes.mjs'
import type {
  EncryptedVaultStateString,
  LockedRepresentationString,
} from './interfaces/Vault.mjs'

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
  Passphrase,
  Salt,
  DeviceId,
  DeviceType,
  DeviceFriendlyName,
  PublicSyncDevice,
}
