import TwoFaLib, { createTwoFaLib } from './TwoFaLib.mjs'
// import NodeCryptoProvider from './CryptoProviders/node/index.mjs'
// import BrowserCryptoProvider from './CryptoProviders/browser/index.mjs'

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
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  PrivateKey,
  SymmetricKey,
  PublicKey,
  Passphrase,
  Salt,
} from './interfaces/CryptoLib.mjs'
import { SaveFunction } from './interfaces/SaveFunction.mjs'
import type { SyncDevice, UserId } from './interfaces/SyncTypes.mjs'

import {
  TwoFALibError,
  InitializationError,
  AuthenticationError,
  EntryNotFoundError,
  TokenGenerationError,
} from './TwoFALibError.mjs'

export {
  TwoFaLib,
  createTwoFaLib,
  TwoFALibError,
  InitializationError,
  AuthenticationError,
  EntryNotFoundError,
  TokenGenerationError,
}

export type {
  Entry,
  EntryId,
  NewEntry,
  EntryMeta,
  EntryType,
  TotpPayload,
  CryptoLib,
  EncryptedPrivateKey,
  EncryptedSymmetricKey,
  PrivateKey,
  SymmetricKey,
  SaveFunction,
  PublicKey,
  Passphrase,
  Salt,
  UserId,
  SyncDevice,
}
