import TwoFaLib from './TwoFaLib.mjs'

import type Entry from './interfaces/Entry.mjs'
import type {
  EntryId,
  NewEntry,
  EntryMeta,
  EntryType,
  TotpPayload,
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
  SyncDevice,
  DeviceId,
  DeviceType,
} from './interfaces/SyncTypes.mjs'
import type { EncryptedVaultData } from './interfaces/Vault.mjs'
import type {
  ChangedEventData,
  ChangedEventWasChangedSinceLastEvent,
} from './interfaces/Events.mjs'

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
  EntryType,
  TotpPayload,
  EncryptedVaultData,
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
  ChangedEventWasChangedSinceLastEvent,
  ChangedEventData,
  SyncDevice,
}
